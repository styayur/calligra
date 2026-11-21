const { randomBytes } = require('node:crypto')
const { spawn } = require('node:child_process')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const readline = require('node:readline')

const paths = new Map([
  ['status', 'GET'], ['fonts', 'POST'], ['documents/docx', 'POST'],
  ['documents/odt', 'POST'], ['scan-recognition', 'POST'],
])

function companion(app) {
  const version = app.getVersion()
  const resources = join(process.resourcesPath, 'companion')
  const local = join(app.getPath('userData'), 'companion', version)
  const python = join(local, 'venv', 'Scripts', 'python.exe')
  const installed = join(local, 'installed.txt')
  const requirements = join(resources, 'requirements-companion.txt')
  let child, launching, task, port, token

  function execute(program, args, timeout) {
    return new Promise((resolve, reject) => {
      const current = spawn(program, args, { windowsHide: true, cwd: local, stdio: 'ignore' })
      task = current
      const watchdog = setTimeout(() => {
        current.kill()
        reject(new Error('本机辅助服务安装超时。请检查网络或代理设置后重试。'))
      }, timeout)
      current.on('error', reject)
      current.on('exit', (code) => code === 0 ? resolve() : reject(new Error('启动或安装 Python 依赖失败。请检查 Python 版本和网络设置。')))
      current.on('close', () => {
        clearTimeout(watchdog)
        if (task === current) task = undefined
      })
    })
  }

  async function start() {
    if (!existsSync(requirements)) throw new Error('当前安装包缺少 Companion。请重新安装 Calligra。')
    mkdirSync(local, { recursive: true })
    if (!existsSync(python)) {
      const command = ['-I', '-c', "import struct,sys,venv; assert struct.calcsize('P') == 8; assert sys.version_info[:2] in {(3,12),(3,13)}; venv.create(sys.argv[1], with_pip=True)", join(local, 'venv')]
      let created = false
      for (const [program, args] of [['py.exe', ['-3.12']], ['py.exe', ['-3.13']], ['python.exe', []]]) {
        try {
          await execute(program, [...args, ...command], 45000)
          created = true
          break
        } catch {}
      }
      if (!created) throw new Error('需要安装 64 位 Python 3.12 或 3.13，并启用 Python Launcher 或将 Python 加入 PATH。')
    }
    const requirementsText = readFileSync(requirements, 'utf8')
    if (!existsSync(installed) || readFileSync(installed, 'utf8') !== requirementsText) {
      await execute(python, ['-I', '-m', 'pip', 'install', '--disable-pip-version-check',
        '--no-input', '--only-binary=:all:', '-r', requirements], 300000)
      writeFileSync(installed, requirementsText)
    }
    token = randomBytes(32).toString('hex')
    await new Promise((resolve, reject) => {
      const current = spawn(python, ['-I', join(resources, 'launch_companion.py')], {
        windowsHide: true, cwd: local, stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, CALLIGRA_MANAGED_TOKEN: token },
      })
      child = current
      const watchdog = setTimeout(() => {
        current.kill()
        reject(new Error('本机辅助服务启动超时。请重试。'))
      }, 30000)
      const lines = readline.createInterface({ input: current.stdout })
      lines.on('line', (line) => {
        const match = /^CALLIGRA_READY ([0-9]{1,5})$/.exec(line)
        if (match && Number(match[1]) > 0 && Number(match[1]) <= 65535) {
          port = Number(match[1])
          clearTimeout(watchdog)
          resolve()
        }
      })
      current.on('error', reject)
      current.on('exit', () => {
        clearTimeout(watchdog)
        if (child === current) { child = undefined; port = undefined; token = undefined }
        reject(new Error('本机辅助服务已退出。请重新启动。'))
      })
    })
  }

  const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

  async function handle(request, route, search) {
    // Renderer calls are same-origin. The child listens on a dynamic loopback port
    // and receives its per-process credential only from this main process.
    if (route === 'start' && request.method === 'POST') {
      try {
        if (!port && !launching) {
          launching = start().finally(() => { launching = undefined })
        }
        await launching
        return json({ ready: Boolean(port) })
      } catch (error) {
        return json({ detail: error.message }, 503)
      }
    }
    if (paths.get(route) !== request.method) return json({ detail: 'Unknown Companion route' }, 404)
    if (!port) return json({ ready: false, detail: '请先启动本机辅助服务。' }, route === 'status' ? 200 : 503)
    const headers = { Authorization: 'Bearer ' + token }
    const type = request.headers.get('content-type')
    if (type) headers['Content-Type'] = type
    try {
      return await fetch('http://127.0.0.1:' + port + '/api/workbench/' + route + search, {
        method: request.method, headers, body: request.body ?? undefined, duplex: 'half',
        redirect: 'error', signal: request.signal,
      })
    } catch {
      return json({ detail: '本机辅助服务连接中断。请重新启动。' }, 503)
    }
  }

  app.on('before-quit', () => { task?.kill(); child?.kill() })
  return handle
}

module.exports = companion
