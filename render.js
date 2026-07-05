const fs = require('fs');
const path = require('path');

// 读取最新生成的脚本
const scriptsDir = path.join(__dirname, 'scripts');
const files = fs.readdirSync(scriptsDir).filter(f => f.endsWith('.json'));
if (files.length === 0) {
  console.log('请先生成脚本: node main.js');
  process.exit(1);
}

const latest = files[files.length - 1];
const script = JSON.parse(fs.readFileSync(path.join(scriptsDir, latest), 'utf8'));

// 生成 HTML
let scenesHtml = '';
for (const s of script.scenes) {
  scenesHtml += `
    <div class="scene" data-duration="${s.duration}">
      <div class="visual"><p>${s.visual}</p></div>
      <div class="narration">${s.narration}</div>
    </div>`;
}

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${script.title}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #0d0d0d; color: #fff; font-family: -apple-system, sans-serif; display: flex; justify-content: center; min-height: 100vh; }
#app { width: 480px; max-width: 100vw; position: relative; overflow: hidden; background: #1a1a2e; }
#canvas { width: 100%; aspect-ratio: 9/16; background: #16213e; display: flex; align-items: center; justify-content: center; position: relative; }
#canvas h2 { font-size: 24px; text-align: center; padding: 20px; line-height: 1.5; }
#controls { padding: 20px; text-align: center; }
#playbtn { background: #e94560; color: #fff; border: none; padding: 14px 40px; border-radius: 30px; font-size: 18px; cursor: pointer; font-weight: bold; }
#playbtn:hover { background: #ff6b81; }
#subtitles { padding: 20px; min-height: 80px; font-size: 18px; line-height: 1.6; text-align: center; color: #ddd; }
#progress { height: 4px; background: #333; margin: 0 20px; border-radius: 2px; }
#progress div { height: 100%; background: #e94560; width: 0%; border-radius: 2px; transition: width 0.3s; }
#scene-indicator { text-align: center; color: #888; font-size: 14px; padding: 10px; }
.timer { text-align: center; color: #888; font-size: 14px; padding: 5px 0; }
.visual-text { color: #aaa; font-size: 13px; padding: 15px; text-align: center; font-style: italic; border-top: 1px solid #333; }
.status { color: #666; text-align: center; padding: 10px; font-size: 14px; }
</style>
</head>
<body>
<div id="app">
  <div id="canvas"><h2 id="title">${script.title}</h2></div>
  <div id="progress"><div id="progress-bar"></div></div>
  <div id="subtitles">点击播放，AI 为你朗读</div>
  <div id="scene-indicator">1 / ${script.scenes.length}</div>
  <div class="timer"><span id="timer">0:00</span> / ${Math.floor(script.duration / 60)}:${String(script.duration % 60).padStart(2, '0')}</div>
  <div id="controls"><button id="playbtn">▶ 播放</button></div>
  <div class="visual-text" id="visual"></div>
  <div class="status">💡 浏览器会自动朗读配音，无需额外软件</div>
</div>

<script>
const scenes = ${JSON.stringify(script.scenes)};
const totalDuration = ${script.duration};

const title = document.getElementById('title');
const subtitles = document.getElementById('subtitles');
const visual = document.getElementById('visual');
const indicator = document.getElementById('scene-indicator');
const timer = document.getElementById('timer');
const progressBar = document.getElementById('progress-bar');
const playbtn = document.getElementById('playbtn');

let isPlaying = false;
let currentScene = 0;
let sceneStartTime = 0;
let globalStartTime = 0;
let timerInterval = null;
let synth = window.speechSynthesis;
let utterance = null;
let paused = false;

const bgColors = ['#16213e', '#1a1a2e', '#0f3460', '#533483', '#e94560', '#16213e'];

function showScene(idx) {
  if (idx >= scenes.length) { finish(); return; }
  const s = scenes[idx];
  currentScene = idx;
  title.textContent = s.visual;
  subtitles.textContent = '🔊 ' + s.narration;
  visual.textContent = '🎬 ' + s.visual;
  indicator.textContent = (idx + 1) + ' / ' + scenes.length;
  document.getElementById('canvas').style.background = bgColors[idx % bgColors.length];
}

function speakScene(idx) {
  if (idx >= scenes.length) { finish(); return; }
  const s = scenes[idx];
  showScene(idx);
  
  if (synth.speaking) synth.cancel();
  
  utterance = new SpeechSynthesisUtterance(s.narration);
  utterance.lang = 'zh-CN';
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  
  utterance.onend = function() {
    speakScene(idx + 1);
  };
  
  utterance.onerror = function() {
    // fallback: auto advance
    setTimeout(() => speakScene(idx + 1), s.duration * 1000);
  };
  
  synth.speak(utterance);
}

function finish() {
  isPlaying = false;
  playbtn.textContent = '▶ 重播';
  clearInterval(timerInterval);
}

function startPlayback() {
  isPlaying = true;
  playbtn.textContent = '⏹ 播放中...';
  globalStartTime = Date.now();
  currentScene = 0;
  
  // Start timer
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - globalStartTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    timer.textContent = mins + ':' + String(secs).padStart(2, '0');
    const pct = Math.min(100, (elapsed / totalDuration) * 100);
    progressBar.style.width = pct + '%';
  }, 200);
  
  speakScene(0);
}

playbtn.addEventListener('click', function() {
  if (synth.speaking) {
    synth.cancel();
    clearInterval(timerInterval);
    isPlaying = false;
    playbtn.textContent = '▶ 重播';
    return;
  }
  startPlayback();
});

// Show first scene
showScene(0);
</script>
</body>
</html>`;

const outDir = path.join(__dirname, 'player');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
const outFile = path.join(outDir, latest.replace('.json', '.html'));
fs.writeFileSync(outFile, html, 'utf8');

console.log('✅ 播放器已生成: ' + outFile);
console.log('📌 在浏览器中打开这个文件即可播放');
