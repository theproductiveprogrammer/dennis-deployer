'use strict'
const fs = require('fs')
const path = require('path')

const shell = require('shelljs')
const ssh2 = require('ssh2')

/*    understand/
 * Main entry point into the program
 */
function main() {
  shell.config.silent = true

  deploy(process.argv[2], process.argv[3], err => {
    if(err) console.error(err)
  })
}

function usage() {
  return `npm start <deployment instructions> <dest>
  see README.md for details`
}

/*    way/
 * Load the base variables and perform the instructions
 */
function deploy(f, dst, cb) {
  if(!name) return cb(usage())
  if(!dst) return cb(usage())

  loadInitialVars(f, dst, (err, vars) => {
    if(err) return cb(err)

    for(let k in vars) shell.echo(`setting ${k} = ${vars[k]}`)

    let ctx = { vars }
    doCmds(f, ctx, err => {
      if(ctx.conns) {
        for(let k in ctx.conns) ctx.conns[k].ssh.end()
      }
      cb(err)
    })
  })
}

function loadInitialVars(f, dst, cb) {
  let here = path.dirname(f)
  let name = path.basename(f)
  cb(null, {
    dst,
    here,
    name,
    pwd: process.env.PWD,
    tmp: shell.tempdir(),
  })
}

function doCmds(f, ctx, cb) {
  let info = shell.cat(f).toString()
  if(!info) return cb(`Failed to read ${f}`)
  let lines = info.split(/[\r\n]/g)
              .map(l => l.trim())
              .filter(l => l)
              .filter(l => l[0] != '#')
  doCmdNdx(lines, 0, ctx, cb)
}

function doCmdNdx(lines, ndx, ctx, cb) {
  if(ndx >= lines.length) return cb()
  let l = lines[ndx].split(' ')
  let cmd = { word: l[0], args: l.slice(1).join(' ') }

  resolveVariables(ctx, cmd.args, (err, inst) => {
    if(err) return cb(err)
    cmd.inst = inst

    handle_cmd_1(ctx, cmd, err => {
      if(err) cb(err)
      else doCmdNdx(lines, ndx+1, ctx, cb)
    })
  })

  function handle_cmd_1(ctx, cmd, cb) {
    let m = {
      "let": bind_var_1,
      "do": do_cmds_1,
      tellme,
      copy,
      run,
    }

    let word = cmd.word
    let handler = m[word] || m[cmd.word]
    if(!handler) return cb(`Did not understand ${cmd.word}`)
    handler(cmd, ctx, cb)
  }

  function dummy(cmd, ctx, cb) {
    console.log(cmd.word, cmd.inst)
    cb()
  }

  function bind_var_1(cmd, ctx, cb) {
    shell.echo(`setting ${cmd.args}`)
    let nv = cmd.inst.split("=")
    if(nv.length != 2) return cb(`Could not set ${cmd.args}`)
    ctx.vars[nv[0].trim()] = nv[1].trim()
    cb()
  }

  function do_cmds_1(cmd, ctx, cb) {
    let inst = cmd.inst
    if(inst[0] == '"') inst = tr(inst)
    let here = ctx.vars.here
    ctx.vars.here = path.dirname(inst)
    doCmds(inst, ctx, err => {
      if(err) cb(err)
      else {
        ctx.vars.here = here
        cb()
      }
    })
  }
}

/*  trim quote */
function tq(s) {
  if(!s) return s
  s = trim(s)
  if(s[0] == '"') return tr(s)
  else return s
}
/*  trim 1-char off ends */
function tr(s) { return s.substring(1,s.length-1).trim() }

function resolveVariables(ctx, args, cb) {
  let dst = resolve_dst_1(ctx)

  let rx = /\{[-A-Za-z0-9_]*?\}/g
  let m = args.match(rx)
  if(m) {
    for(let i = 0;i < m.length;i++) {
      let curr = m[i]
      let v = tr(curr)
      if(v == "dst") args = args.replace("{dst}", dst)
      else if(v == "dst.name") args = args.replace("{dst.name}", ctx.vars.dst)
      else {
        let val = ctx.vars[v]
        if(!val) return cb(`Could not resolve variable: {${v}}`)
        args = args.replace(curr, val)
      }
    }
  }
  return cb(null, args)


  /*    problem/
   * the destination variable can point to another variable
   * for example:
   *    npm start instructions.dpi myserver
   * (here myserver is another variable)
   *    let myserver = user@server:/home/dest -p 22
   *
   * And the user would want the destination to resolve to
   *    {dst} = user@server:/home/dest
   *
   *    way/
   * We look for context variables that match the destination
   * and resolve them if found.
   */
  function resolve_dst_1(ctx) {
    let dst = ctx.vars.dst
    dst = ctx.vars[dst] ? ctx.vars[dst] : dst
    dst = dst ? dst.split(" -p ")[0] : dst
    return dst
  }
}

/*
  let f = path.join(process.env.PWD, instructions)
  let info = shell.cat(f).toString()
  info = parse(name, info, f)
  if(isRemote(info.dst)) {
    setupSSH(info.dst, (err, conn) => {
      if(err) return cb(err)
      info.cmds.map(cmd => cmd.conn = conn)
      doCmdNdx(info.cmds, 0, err => {
        conn.ssh.end()
        if(err) return cb(err)
      })
    })
  } else {
    doCmdNdx(info.cmds, 0, cb)
  }
}*/

function setupRemote(dst, ctx, cb) {
  if(!ctx.conns) ctx.conns = {}
  if(ctx.conns[dst]) return cb(null, ctx.conns[dst])

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
      ctx.conns[dst] = { ssh, sftp }
      cb(null, ctx.conns[dst])
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
    run,
  }

  let word = cmd.word
  let handler = m[word] || m[cmd.word]
  if(!handler) return cb(`Did not understand ${cmd.word}`)
  handler(cmd, err => {
    if(err) return cb(err)
    doCmdNdx(cmds, ndx+1, cb)
  })
}

function tellme(cmd, ctx, cb) {
  let say = tq(cmd.inst)
  shell.echo(`===> ${say}` )
  cb()
}

function run(cmd, ctx, cb) {
  let ei = cmd.inst.split(" in ")
  if(ei.length != 2) return cb(`Did not understand run ${cmd.args}`)
  let exe = tq(ei[0].trim())
  let ignore_err
  if(exe.endsWith("|| true")) {
    ignore_err = true
    exe = exe.substring(0, exe.length - "|| true".length).trim()
  }
  let loc = tq(ei[1].trim())
  if(isRemote(loc)) {
    setupRemote(dst, ctx, (err, conn) => {
      if(err) return cb(err)
      loc = sshinfo(dst).loc
      shell.echo(`running ${cmd.args}`)
      exe = `cd ${loc} && ${exe}`
      sshe(exe, conn, err => {
        if(err && !ignore_err) cb(err)
        else cb()
      })
    })
  } else {
    shell.echo(`running ${cmd.args}`)
    exe = `cd ${loc} && ${exe}`
    exe = shell.exec(exe)
    if(exe.code && !ignore_err) cb(exe.stderr)
    else cb()
  }
}


function copydir(cmd, ctx, cb) {
  let sd = cmd.inst.split(" to ")
  if(sd.length != 2) return cb(`cannot get src/dest from ${cmd.word} ${cmd.args}`)
  let src = path.resolve(tq(sd[0]))
  let dst = tq(sd[1])
  shell.echo(`copying ${cmd.args}`)
  if(isRemote(dst)) {
    setupRemote(dst, ctx, (err, conn) => {
      if(err) return cb(err)
      copydir_ssh_1(src, dst, conn, cb)
    })
  } else {
    dst = path.resolve(dst)
    copydir_1(src, dst, cb)
  }

  function copydir_1(src, dst, cb) {
    shell.config.fatal = true
    let err
    try {

      let dstdir = path.dirname(dst)
      let srcdir = path.dirname(src)
      let name = path.basename(src)

      let tar = path.join(ctx.vars.tmp,path.basename(src))+'.tar'
      if(shell.test('-f', tar)) shell.rm(tar)
      shell.exec(`mkdir -p ${dstdir}`)
      shell.exec(`cd ${srcdir} && tar -cf ${tar} ${name}`)
      shell.exec(`cd ${dstdir} && tar -xf ${tar}`)

    } catch(e) {
      err = e.message
    }

    shell.config.fatal = false
    cb(err)
  }

  function copydir_ssh_1(src, dst, conn, cb) {
    dst = sshinfo(dst).loc
    let dstdir = path.dirname(dst)
    let srcdir = path.dirname(src)
    let name = path.basename(src)

    let tar = path.join(shell.tempdir(),path.basename(src))+'.tar'
    if(shell.test('-f', tar)) shell.rm(tar)
    if(shell.test('-f', `${tar}.gz`)) shell.rm(`${tar}.gz`)
    shell.exec(`
    cd ${srcdir} &&
    tar -cf ${tar} ${name} &&
    gzip -9 ${tar}
  `)
    let tgz = path.join(dstdir, `${name}.tar.gz`)
    sshe(`mkdir -p ${dstdir}`, conn, err => {
      if(err) cb(err)
      else conn.sftp.fastPut(`${tar}.gz`, tgz, err => {
        sshe(`
        cd ${dstdir} &&
        tar -xf ${name}.tar.gz &&
        rm ${name}.tar.gz
        `, conn, cb)
      })
    })
  }
}

function copy(cmd, ctx, cb) {
  let sd = cmd.inst.split(" to ")
  if(sd.length != 2) return cb(`cannot get src/dest from ${cmd.word} ${cmd.args}`)
  let src = path.resolve(tq(sd[0]))
  let dst = path.resolve(tq(sd[1]))
  if(shell.test('-d', src)) return copydir(cmd, ctx, cb)
  shell.echo(`copying ${cmd.args}`)
  if(isRemote(dst)) {
    setupRemote(dst, ctx, (err, conn) => {
      if(err) return cb(err)
      copy_ssh_1(src, dst, conn, cb)
    })
  } else {
    copy_1(src, dst, cb)
  }

  function copy_1(src, dst, cb) {
    shell.config.fatal = true
    let err

    try {
      let dstdir = path.dirname(dst)
      shell.mkdir('-p', dstdir)
      shell.cp(src, dst)
    } catch(e) {
      err = e.message
    }

    shell.config.fatal = false
    cb()
  }

  function copy_ssh_1(src, dst, conn, cb) {
    dst = sshinfo(dst).loc
    let dstdir = path.dirname(dst)
    sshe(`mkdir -p ${dstdir}`, conn, err => {
      if(err) cb(err)
      else conn.sftp.fastPut(src, dst, cb)
    })
  }
}

function p(loc, cmd) {
  return '"' +
    loc.replace(cmd.src,'{src}')
    .replace(cmd.dst,'{dst}')
    .replace(TMPDIR, '{tmp}')
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
function parse(name, data, f) {
  let lines = data.split(/[\r\n]/g)
                .map(l => l.trim())
                .filter(l => l)
                .filter(l => l[0] != '#')
  if(lines.length < 3) throw `No information in ${f}`
  if(!lines[0].startsWith("src:")) throw "First line must be 'src:'"
  if(!lines[1].startsWith("dst:")) throw "Second line must be 'dst:'"

  let src = lines[0].substring("src:".length).trim()
  src = path.resolve(resolveTokens(src, name))
  let dst = lines[1].substring("dst:".length).trim()
  dst = resolveTokens(dst, name, src)
  if(!isRemote(dst)) dst = path.resolve(dst)
  let cmds = lines.slice(2)
              .map(l => resolveTokens(l, name, src, dst))
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
 *    {deploy} ==> name of deployment
 *    {tmp} ==> temporary directory
 *    {pwd} ==> location of present working directory
 */
let TMPDIR = shell.tempdir()
function resolveTokens(line, name, src, dst) {
  dst = dst ? dst.split(" -p ")[0] : dst
  line = line.replace(/\{src\}/g, src)
  line = line.replace(/\{dst\}/g, dst)
  line = line.replace(/\{deploy\}/g, name)
  line = line.replace(/\{tmp\}/g, TMPDIR)
  line = line.replace(/\{pwd\}/g, process.env.PWD)
  return line
}

main()
