'use strict'
const fs = require('fs')
const path = require('path')

const shell = require('shelljs')
const ssh2 = require('ssh2')

function main() {
  shell.config.fatal = true

  let instructions = process.argv[2]
  if(!instructions) throw "I need instructions (see README)"
  let name = path.basename(instructions, '.dpi')

  let f = path.join(process.env.PWD, instructions)
  let info = shell.cat(f).toString()
  info = parse(info, f)
  if(isRemote(info.dst)) {
    setupSSH(info.dst, (err, conn) => {
      if(err) throw err
      info.cmds.map(cmd => cmd.conn = conn)
      doCmdNdx(info.cmds, 0, err => {
        conn.ssh.end()
        if(err) throw err
      })
    })
  } else {
    doCmdNdx(info.cmds, 0, err => {
      if(err) throw err
    })
  }
}

function setupSSH(dst, cb) {
  let sshi = sshinfo(dst)
  shell.echo(`Connecting to: ${JSON.stringify(sshi)}`)

  let key = path.join(process.env.HOME, '.ssh', 'id_rsa')
  sshi.privateKey = fs.readFileSync(key)

  let ssh = new ssh2.Client()
  ssh.on('ready', err => {
    if(err) cb(err)
    else ssh.sftp(function(err, sftp) {
      if(err) {
        ssh.close()
        return cb(err)
      }
      cb(null, { ssh, sftp })
    })
  })
  ssh.on('error', cb)
  ssh.connect(sshi)
}

function sshinfo(str) {
  let info1 = str.split(/[@:]/g)
  let username = info1[0]
  let host = info1[1]
  let info2 = info1[2].split(' -p ')
  let loc = info2[0]
  let port = info2[1]
  if(!port) port = "22"
  return { username, host, loc, port }
}

function doCmdNdx(cmds, ndx, cb) {
  if(ndx >= cmds.length) return cb()
  let cmd = cmds[ndx]

  let m = {
    tellme,
    copy,
    copy_ssh,
    copydir,
    copydir_ssh,
  }

  let word = cmd.word
  if(isRemote(cmd.dst)) word += "_ssh"

  let handler = m[word] || m[cmd.word]
  if(!handler) throw `Did not understand ${cmd.word}`
  handler(cmd, err => {
    if(err) return cb(err)
    doCmdNdx(cmds, ndx+1, cb)
  })
}

function tellme(cmd, cb) { shell.echo(cmd.args); cb() }

function copydir(cmd, cb) {
  let sd = cmd.args.split(' ')
  if(sd.length != 2) throw `cannot get src/dest from ${cmd}`
  let src = path.resolve(sd[0])
  let dst = path.resolve(sd[1])
  let dstdir = path.dirname(dst)
  let srcdir = path.dirname(src)
  let name = path.basename(src)

  shell.echo(`copying ${p(src,cmd)} to ${p(dst,cmd)}`)
  let tar = path.join(shell.tempdir(),path.basename(src))+'.tar'
  if(shell.test('-f', tar)) shell.rm(tar)
  shell.exec(`cd ${srcdir} && tar -cvf ${tar} ${name}`)
  shell.exec(`cd ${dstdir} && tar -xvf ${tar}`)
}

function copydir_ssh(cmd, cb) {
  let sd = cmd.args.split(' ')
  if(sd.length != 2) throw `cannot get src/dest from ${cmd}`
  let src = path.resolve(sd[0])
  let sshi = sshinfo(sd[1])
  let dst = sshi.loc
  let dstdir = path.dirname(dst)
  let srcdir = path.dirname(src)
  let name = path.basename(src)

  shell.echo(`copying ${p(src,cmd)} to ${p(dst,cmd)}`)
  let tar = path.join(shell.tempdir(),path.basename(src))+'.tar'
  if(shell.test('-f', tar)) shell.rm(tar)
  if(shell.test('-f', `${tar}.gz`)) shell.rm(`${tar}.gz`)
  shell.exec(`
    cd ${srcdir} &&
    tar -cvf ${tar} ${name} &&
    gzip -9 ${tar}
  `)
  let tgz = path.join(dstdir, `${name}.tar.gz`)
  sshe(`mkdir -p ${dstdir}`, cmd.conn, err => {
    if(err) cb(err)
    else cmd.conn.sftp.fastPut(`${tar}.gz`, tgz, err => {
      console.log(`
        cd ${dstdir} &&
        tar -xvf ${name}.tar.gz &&
        rm ${name}.tar.gz
        `)
      sshe(`
        cd ${dstdir} &&
        tar -xvf ${name}.tar.gz &&
        rm ${name}.tar.gz
        `, cmd.conn, cb)
    })
  })
}

function copy(cmd, cb) {
  let sd = cmd.args.split(' ')
  if(sd.length != 2) throw `cannot get src/dest from ${cmd}`
  let src = path.resolve(sd[0])
  let dst = path.resolve(sd[1])
  let dstdir = path.dirname(dst)
  shell.echo(`copying ${p(src,cmd)} to ${p(dst,cmd)}`)
  shell.mkdir('-p', dstdir)
  shell.cp(src, dst)
  cb()
}

function copy_ssh(cmd, cb) {
  let sd = cmd.args.split(' ')
  if(sd.length != 2) throw `cannot get src/dest from ${cmd}`
  let src = path.resolve(sd[0])
  let sshi = sshinfo(sd[1])
  let dst = sshi.loc
  let dstdir = path.dirname(dst)
  shell.echo(`copying ${p(src,cmd)} to ${p(dst,cmd)}`)
  sshe(`mkdir -p ${dstdir}`, cmd.conn, err => {
    if(err) cb(err)
    else cmd.conn.sftp.fastPut(src, dst, cb)
  })
}

function p(loc, cmd) {
  return '"' +
    loc.replace(cmd.src,'')
    .replace(cmd.dst,'')
    .replace(/^[/]/,'')
  + '"'
}

function sshe(cmd, conn, cb) {
  let go = conn.ssh.exec(cmd, (err, stream) => {
    if(err) cb(err)
    stream.on('data', o)
    stream.stderr.on('data', o)
    stream.on('close', (code, signal) => {
      if(code || signal) {
        cb(`Failed with code: ${code} and signal: ${signal}`)
      } else {
        if(go) cb()
      }
    })
  })
  if(!go) conn.ssh.once('continue', cb)

  function o(d) {
    let s = d.toString('utf8')
    console.log(s.trimEnd())
  }
}



function isRemote(p) {
  return p.indexOf('@') != -1 && p.indexOf(':') != -1
}

/*    understand/
 * We expect information to be in this format:
 * src: <src path>
 * # Comment
 * dst: <destination path>
 * <list of commands>
 */
function parse(data, f) {
  let lines = data.split(/[\r\n]/g)
                .map(l => l.trim())
                .filter(l => l)
                .filter(l => l[0] != '#')
  if(lines.length < 3) throw `No information in ${f}`
  if(!lines[0].startsWith("src:")) throw "First line must be 'src:'"
  if(!lines[1].startsWith("dst:")) throw "Second line must be 'dst:'"

  let src = lines[0].substring("src:".length).trim()
  src = path.resolve(resolveTokens(src))
  let dst = lines[1].substring("dst:".length).trim()
  dst = resolveTokens(dst, src)
  if(!isRemote(dst)) dst = path.resolve(dst)
  let cmds = lines.slice(2)
              .map(l => resolveTokens(l, src, dst))
              .map(to_cmd_1)

  return { src, dst, cmds }

  function to_cmd_1(l) {
    l = l.split(' ')
    return { src, dst, word: l[0], args: l.slice(1).join(' ') }
  }
}

/*    way/
 * Resolve any tokens on the given line:
 *    {src} ==> source directory
 *    {dst} ==> destination directory
 *    {tmp} ==> temporary directory
 *    {pwd} ==> location of present working directory
 */
let TMPDIR = shell.tempdir()
function resolveTokens(line, src, dst) {
  line = line.replace(/\{src\}/g, src)
  line = line.replace(/\{dst\}/g, dst)
  line = line.replace(/\{tmp\}/g, TMPDIR)
  line = line.replace(/\{pwd\}/g, process.env.PWD)
  return line
}

main()