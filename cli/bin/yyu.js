#!/usr/bin/env node
/**
 * yuu-dev-kit CLI
 * 用法: yyu create <project-name>
 */

import { spawnSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, readdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CLI_DIR = resolve(join(__dirname, '..'));
const KIT_DIR = resolve(join(CLI_DIR, '..'));
const BASE_DIR = join(KIT_DIR, 'base');
const MODULES_DIR = join(KIT_DIR, 'modules');
const CONVENTIONS_DIR = join(KIT_DIR, 'conventions');

const rl = createInterface({ input: process.stdin, output: process.stdout });

// ═══════════════════════════════════════════════
//  入口
// ═══════════════════════════════════════════════

const cmd = process.argv[2];
const arg = process.argv[3];

main().catch(err => { console.error('Error:', err.message); process.exit(1); });

async function main() {
  if (cmd === 'create') {
    await createProject();
  } else if (cmd === 'update') {
    await updateProject();
  } else {
    console.log(`yuu-dev-kit v2.0.0

用法:
  yyu create <project-name>    创建新项目
  yyu update                   同步 yuu-dev-kit 模板升级（在项目中运行）`);
    rl.close();
    process.exit(0);
  }
}

// ═══════════════════════════════════════════════
//  yyu create
// ═══════════════════════════════════════════════

async function createProject() {
  const projectName = arg || 'my-project';
  const targetDir = resolve(process.cwd(), arg ? projectName : projectName);

  console.log(`
╔══════════════════════════════════════════╗
║  yuu-dev-kit — 创建新项目               ║
╚══════════════════════════════════════════╝`);

  // ── 第 1 问：项目名 ──
  const nameInput = await question(`项目名 [${projectName}]: `);
  const name = nameInput || projectName;
  const finalDir = arg ? targetDir : resolve(process.cwd(), name);

  // ── 第 2 问：语言 ──
  console.log('\n项目语言:');
  console.log('  1) Node.js');
  console.log('  2) Python');
  console.log('  3) 其他（最小初始化）');
  const langInput = await question('选择 [1]: ');
  const lang = langInput || '1';
  const langDir = lang === '1' ? 'node' : lang === '2' ? 'python' : '';

  // ── 第 3 问：第二层 ──
  let installLogger = 'n', installErrors = 'n', installHealth = 'n';
  if (['1', '2'].includes(lang)) {
    console.log('\n━━━ 第二层：基础设施（按需选装）━━━');
    const loggerInput = await question('结构化日志 (logger)? [Y/n]: ');
    installLogger = (loggerInput || 'y').toLowerCase();
    const errorsInput = await question('统一错误处理 (RFC 9457)? [y/N]: ');
    installErrors = (errorsInput || 'n').toLowerCase();
    const healthInput = await question('健康检查 (/livez + /readyz)? [y/N]: ');
    installHealth = (healthInput || 'n').toLowerCase();
  }

  // ── 第 4 问：第三层 ──
  console.log('\n━━━ 第三层：约定包（选装）━━━');
  const gitInput = await question('Git 约定 (.gitmessage + PR 模板)? [y/N]: ');
  const installGit = (gitInput || 'n').toLowerCase();
  const testingInput = await question('测试策略文档 (TESTING.md)? [y/N]: ');
  const installTesting = (testingInput || 'n').toLowerCase();
  const securityInput = await question('安全策略 (SECURITY.md)? [y/N]: ');
  const installSecurity = (securityInput || 'n').toLowerCase();

  // ── 确认 ──
  console.log(`
╔══════════════════════════════════════════╗
║  第一层（必装）: 认知支架 + Memory Bank  ║
║  第二层（选装）: logger=${installLogger} errors=${installErrors} health=${installHealth}
║  第三层（选装）: git=${installGit} testing=${installTesting} security=${installSecurity}
║  目标: ${finalDir}
╚══════════════════════════════════════════╝`);
  const confirm = await question('确认创建? [Y/n]: ');
  if (confirm === 'n' || confirm === 'N') { console.log('已取消'); rl.close(); process.exit(0); }

  // ── 检查目录 ──
  if (existsSync(finalDir) && readdirSync(finalDir).length > 0) {
    const overwrite = await question(`⚠️  ${finalDir} 非空，继续? [y/N]: `);
    if (overwrite !== 'y' && overwrite !== 'Y') { console.log('已取消'); rl.close(); process.exit(0); }
  }

  mkdirSync(finalDir, { recursive: true });
  process.chdir(finalDir);

  // ── 第一层：复制核心 ──
  console.log('\n📁 第一层：核心模板...');
  cpSync(BASE_DIR, finalDir, { recursive: true });
  console.log('✅ 认知支架 + Memory Bank + ADR + Principles');

  // ── 第二层：基础设施 ──
  if (langDir) {
    mkdirSync('lib', { recursive: true });
    for (const [mod, install] of [['logger', installLogger], ['errors', installErrors], ['health', installHealth]]) {
      if (install === 'y') {
        const ext = langDir === 'python' ? 'py' : 'js';
        const src = join(MODULES_DIR, langDir, 'lib', `${mod}.${ext}`);
        if (existsSync(src)) {
          cpSync(src, join('lib', `${mod}.${ext}`));
          console.log(`  ✅ lib/${mod}.${ext}`);
        }
      }
    }
  }

  // ── 第三层：约定包 ──
  if (installGit === 'y') {
    const gDir = join(CONVENTIONS_DIR, 'git');
    cpSync(join(gDir, '.gitmessage'), '.gitmessage');
    mkdirSync('.github', { recursive: true });
    cpSync(join(gDir, 'PULL_REQUEST_TEMPLATE.md'), join('.github', 'PULL_REQUEST_TEMPLATE.md'));
    console.log('  ✅ .gitmessage + PR 模板');
  }
  if (installTesting === 'y') { cpSync(join(CONVENTIONS_DIR, 'testing', 'TESTING.md'), join('docs', 'TESTING.md')); console.log('  ✅ docs/TESTING.md'); }
  if (installSecurity === 'y') { cpSync(join(CONVENTIONS_DIR, 'security', 'SECURITY.md'), 'SECURITY.md'); console.log('  ✅ SECURITY.md'); }

  // ── 写入 .project-init.json ──
  const commit = getTemplateCommit();
  const config = {
    version: '2', kit: 'yuu-dev-kit', project_name: name, language: lang,
    modules: { logger: installLogger, errors: installErrors, health: installHealth },
    conventions: { git: installGit, testing: installTesting, security: installSecurity },
    template_commit: commit, initialized_at: new Date().toISOString().split('T')[0],
  };
  writeFileSync('.project-init.json', JSON.stringify(config, null, 2) + '\n');

  // ── 安装依赖 ──
  console.log('\n📦 安装依赖...');
  if (lang === '1') {
    if (!existsSync('package.json')) { execSync('npm init -y --silent', { stdio: 'ignore' }); }
    execSync('npm install -D dependency-cruiser', { stdio: 'pipe' });
    console.log('  ✅ dependency-cruiser');
    if (installLogger === 'y') { execSync('npm install pino pino-pretty', { stdio: 'pipe' }); console.log('  ✅ pino + pino-pretty'); }
  }

  // ── 首次扫描 ──
  console.log('\n🔍 认知架构首次扫描...');
  if (existsSync('cognitive-scaffold/scripts/cognitive-map.js')) {
    try {
      execSync('node cognitive-scaffold/scripts/cognitive-map.js --scan-only', { stdio: 'pipe' });
    } catch { /* skip */ }
  }

  // ── Git init ──
  console.log('\n🔧 Git init...');
  execSync('git init', { stdio: 'ignore' });
  execSync('git add -A', { stdio: 'ignore' });
  try { execSync('git commit -m "init: yuu-dev-kit scaffold"', { stdio: 'ignore' }); } catch { /* ok */ }

  // ── 完成 ──
  console.log(`
╔══════════════════════════════════════════╗
║  ✅ ${name} 初始化完成
║     认知支架 + Memory Bank + ${installLogger === 'y' ? 'Logger + ' : ''}${installErrors === 'y' ? 'Errors + ' : ''}${installHealth === 'y' ? 'Health' : ''}
╚══════════════════════════════════════════╝

下一步: cd ${name}`);
  rl.close();
}

// ═══════════════════════════════════════════════
//  yyu update
// ═══════════════════════════════════════════════

async function updateProject() {
  console.log('请在有 .project-init.json 的项目目录中运行此命令。');
  // 委托给 update.sh
  const updateScript = join(KIT_DIR, 'update.sh');
  if (existsSync(updateScript)) {
    spawnSync('bash', [updateScript], { stdio: 'inherit', cwd: process.cwd() });
  } else {
    console.log('update.sh 未找到，请手动运行: bash ~/yuu-dev-kit/update.sh');
  }
  rl.close();
}

// ═══════════════════════════════════════════════
//  工具
// ═══════════════════════════════════════════════

function question(prompt) {
  return new Promise(resolve => rl.question(prompt).then(resolve));
}

function getTemplateCommit() {
  try {
    return execSync('git rev-parse HEAD', { cwd: KIT_DIR, stdio: 'pipe' }).toString().trim();
  } catch { return 'unknown'; }
}
