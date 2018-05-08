'use strict'

const minimist = require('minimist')
const express = require('express')
const filelist = require('./lib/filelist')
const fs = require('fs')
const http = require('http')
const mime = require('mime-types')
const path = require('path')
const WebSocket = require('ws')

const STATIC_PATH = path.join(__dirname, 'static')
const STATIC_FRAGMENT = '__static'
const INJECT = `
<script src="/${STATIC_FRAGMENT}/reload.js"></script>`

class Server {
  init (args) {
    const version = require('./package.json').version
    console.log(`Runna webserver version ${version}.`)

    this.hostname = args.hostname || 'localhost'
    this.port = args.port || 8000
    this.cwd = args.cwd ? path.join(process.cwd(), args.cwd) : process.cwd()
    this.app = args.app || express()
  }

  serve (callback) {
    this.app
      .use(`/${STATIC_FRAGMENT}`, express.static(STATIC_PATH))
      .use(`/\\+reload`, (req, res) => {
        res.end()
        this.reloadClients()
      })
      .use('/\\+exit', (req, res) => {
        console.log('Shutting down.')
        res.end()
        process.exit()
      })
      .use('/', (req, res) => {
        let localPath = path.join(this.cwd, req.path.endsWith('/') ? req.path + 'index.html' : req.path)
        let ext = path.extname(localPath)

        // Serve asset.
        if (ext !== '.html') {
          return res.sendFile(localPath)
        }

        // Serve the HTML file.
        fs.readFile(localPath, 'utf8', (err, data) => {
          if (err) {
            err.localPath = localPath
            return this.handleError(req, res, err)
          }

          this.setContentType(res, ext).send(data + INJECT)
        })
      })

    this.listen(callback)
  }

  setContentType (res, ext) {
    let type = mime.lookup(ext) || 'text/plain'
    res.setHeader('content-type', type)
    return res
  }

  handleError (req, res, err) {
    // In case of 404 show the HTML file list.
    fs.readFile(path.join(STATIC_PATH, 'index.html'), 'utf-8', (err, data) => {
      if (err) {
        this.setContentType(res, '.txt').status('500').send(`Error: ${err.toString()}`)
      }
      let html = filelist(this.cwd)
      data = data.replace('DATA', html)
      this.setContentType(res, '.html').status('404').send(data + INJECT)
    })
  }

  listen (callback) {
    this.app
      .listen(this.port, this.hostname, () => {
        let host = `${this.hostname}:${this.port}`
        console.log(`Listening at ${host} (${this.cwd})...`)

        // Start the websocket server.
        this.wss = new WebSocket.Server({
          host: this.hostname,
          port: this.port + 1
        })

        callback && callback()
      })
      .on('error', err => {
        if (err.message.indexOf('EADDRINUSE') !== -1) {
          console.log(`Unable to start server on port ${this.port}.`)
        }
      })
  }

  reloadClients () {
    if (!this.wss) {
      return
    }

    console.log(`Reloading.`)
    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send('reload')
      }
    })
  }

  remoteReload () {
    let options = {host: this.hostname, port: this.port, path: '/+reload', method: 'GET'}
    console.log(`Triggering reload to ${this.hostname}:${this.port}.`)
    http.get(options, res => {
      // Empty.
    }).end()
  }

  remoteExit () {
    let options = {host: this.hostname, port: this.port, path: '/+exit'}
    console.log(`Triggering exit to ${this.hostname}:${this.port}.`)
    http.get(options, res => {
      // Empty.
    }).on('error', err => {
      if (err.code !== 'ECONNRESET') {
        throw err
      }
    }).end()
  }

  main () {
    let args = minimist(process.argv.slice(2))
    this.init({hostname: args.h, port: args.p, cwd: args.w})

    if (args.r) {
      return this.remoteReload()
    }

    if (args.x) {
      return this.remoteExit()
    }

    this.serve()
  }
}

if (require.main === module) {
  let server = new Server()
  server.main()
}

module.exports = Server
