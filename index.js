'use strict'

const minimist = require('minimist')
const express = require('express')
const filelist = require('./lib/filelist')
const fs = require('fs')
const http = require('http')
const path = require('path')
const WebSocket = require('ws')

const STATIC_PATH = path.join(__dirname, 'static')
const STATIC_FRAGMENT = '_runnawebserver_'
const INJECT = `
<script src="/${STATIC_FRAGMENT}/reload.js"></script>`

class Server {
  getApp (auth) {
    const app = express()
    app.use((req, res, next) => {
      if (!auth) {
        return next()
      }

      const b64auth = (req.headers.authorization || '').split(' ').pop()
      const provided = Buffer.from(b64auth, 'base64').toString()
      if (auth === provided) {
        return next() // Access granted.
      }

      res.set('WWW-Authenticate', 'Basic realm="401"')
      res.status(401).send('Access denied.')
    })
    app.use(`/${STATIC_FRAGMENT}`, express.static(STATIC_PATH))
    app.use(`/\\+reload`, (req, res) => {
      res.end()
      this.reloadClients(app)
    })
    app.use('/\\+exit', (req, res) => {
      console.log('Shutting down.')
      res.end()
      process.exit()
    })

    return app
  }

  serve (app, hostname, port, cwd, callback) {
    const version = require('./package.json').version
    console.log(`Runna webserver version ${version}.`)

    app.use('/', (req, res) => {
      const localPath = path.join(cwd, req.path.endsWith('/') ? req.path + 'index.html' : req.path)
      if (!fs.existsSync(localPath)) {
        return this.handleError(cwd, req, res)
      }

      // Serve static file.
      if (!localPath.endsWith('.html')) {
        return res.sendFile(localPath)
      }

      // Serve the HTML file + JavaScript to handle reloads.
      fs.readFile(localPath, 'utf8', (err, data) => {
        if (err) {
          return console.error(err)
        }

        res.setHeader('content-type', 'text/html')
        res.send(data + INJECT)
      })
    })

    this.listen(app, hostname, port, cwd, callback)
  }

  handleError (cwd, req, res) {
    // In case of 404 show the HTML file list.
    fs.readFile(path.join(STATIC_PATH, 'index.html'), 'utf-8', (err, data) => {
      if (err) {
        return this.setContentType(res, '.txt').status('500').send(`Error: ${err.toString()}`)
      }

      const html = filelist(cwd)
      data = data.replace('$DATA', html)
      res.setHeader('content-type', 'text/html')
      res.status('404').send(data + INJECT)
    })
  }

  listen (app, hostname, port, cwd, callback) {
    app.on('error', err => {
      if (err.message.indexOf('EADDRINUSE') !== -1) {
        console.log(`Unable to start server on port ${port}.`)
      }
    })
    app.listen(port, hostname, () => {
      const host = `${hostname}:${port}`
      console.log(`Listening at ${host} (${cwd})...`)

      // Start the websocket server.
      app.wss = new WebSocket.Server({
        host: hostname,
        port: port + 1
      })

      callback && callback()
    })
  }

  reloadClients (app) {
    if (!app.wss) {
      return
    }

    console.log('Reloading.')
    app.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send('reload')
      }
    })
  }

  remoteReload (hostname, port) {
    const options = {host: hostname, port: port, path: '/+reload', method: 'GET'}
    console.log(`Triggering reload to ${hostname}:${port}.`)
    http.get(options, res => {
      // Empty.
    }).end()
  }

  remoteExit (hostname, port) {
    const options = {host: hostname, port: port, path: '/+exit'}
    console.log(`Triggering exit to ${hostname}:${port}.`)
    http.get(options, res => {
      // Empty.
    }).on('error', err => {
      if (err.code !== 'ECONNRESET') {
        throw err
      }
    }).end()
  }

  main () {
    const args = minimist(process.argv.slice(2))
    const hostname = args.h || 'localhost'
    const port = args.p || 8000
    const cwd = args.w ? path.resolve(args.w) : process.cwd()
    const auth = args.a || null

    if (args.r) {
      return this.remoteReload(hostname, port)
    }

    if (args.x) {
      return this.remoteExit(hostname, port)
    }

    const app = this.getApp(auth)
    this.serve(app, hostname, port, cwd)
  }
}

if (require.main === module) {
  const server = new Server()
  server.main()
}

module.exports = Server
