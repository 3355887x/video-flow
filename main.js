const fs = require('fs');
const path = require('path');
const readline = require('readline');
const https = require('https');

// ── 读取 Key ──
function getKey(provider) {
  try {
    const data = JSON.parse(fs.readFileSync(
      path.join(process.env.HOME, '.openclaw/agents/main/agent/models.json'), 'utf8'
    ));
    return data?.providers?.[provider]?.apiKey || '';
  } catch { return ''; }
}

const DEEPSEEK_KEY = getKey('deepseek');

// ── 调用 DeepSeek ──
function callAI(prompt) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: '你是视频脚本专家。输出严格JSON格式，不要其他文字。' },
        { role: 'user', content: prompt }
      ]
    });

    const req = https.request({
      hostname: 'api.deepseek.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + DEEPSEEK_KEY,
      }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body).choices[0].message.content); }
        catch(e) { reject(e.message); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── 生成脚本 ──
async function generateScript(topic) {
  console.log('\n🎬 正在生成视频脚本...\n');

  const prompt = `为主题"${topic}"生成一个60秒短视频的逐字脚本。

要求：
- 口语化，适合朗读
- 前3秒抓注意力
- 面向普通观众

输出JSON格式：
{
  "title": "标题",
  "duration": 60,
  "scenes": [
    {
      "id": 1,
      "narration": "旁白文案",
      "duration": 秒数,
      "visual": "画面描述"
    }
  ]
}`;

  const raw = await callAI(prompt);
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI返回格式不对:\n' + raw.substring(0, 200));
  const script = JSON.parse(jsonMatch[0]);

  // 保存脚本
  const dir = path.join(__dirname, 'scripts');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const safeName = topic.replace(/[\/\?<>\\:*|"]/g, '_');
  const scriptFile = path.join(dir, safeName + '.json');
  fs.writeFileSync(scriptFile, JSON.stringify(script, null, 2), 'utf8');

  console.log('✅ 脚本已保存: ' + scriptFile);
  console.log('   标题: ' + script.title);
  console.log('   时长: ' + script.duration + '秒');
  console.log('   场景: ' + script.scenes.length + '个\n');

  return { script, safeName, scriptFile };
}

// ── 导出剪映草稿 ──
function exportCapCut(script, safeName) {
  const capcutDir = path.join(__dirname, 'capcut', safeName, 'draft_content');
  if (!fs.existsSync(capcutDir)) fs.mkdirSync(capcutDir, { recursive: true });

  // content.json — 剪映可识别的草稿格式
  const content = {
    title: script.title,
    width: 1080,
    height: 1920,
    duration: script.duration,
    tracks: [
      {
        type: 'text',
        clips: script.scenes.map((s, i) => ({
          id: 'text_' + i,
          start: script.scenes.slice(0, i).reduce((a, b) => a + b.duration, 0),
          duration: s.duration,
          content: s.visual,
          style: { fontSize: 28, align: 'center', color: '#FFFFFF' }
        }))
      }
    ],
    subtitles: script.scenes.map(s => ({
      text: s.narration,
      start: script.scenes.slice(0, script.scenes.indexOf(s)).reduce((a, b) => a + b.duration, 0),
      duration: s.duration
    }))
  };

  fs.writeFileSync(path.join(capcutDir, 'content.json'), JSON.stringify(content, null, 2), 'utf8');
  console.log('✅ 剪映草稿已导出: capcut/' + safeName + '/');
}

// ── 导出配音脚本 ──
function exportAudioScript(script, safeName) {
  const audioDir = path.join(__dirname, 'audio');
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir);

  // 生成配音脚本：每行一句，剪映/配音软件可直接导入
  let ttsScript = '';
  let srtContent = '';
  let time = 0;

  for (const s of script.scenes) {
    ttsScript += s.narration + '\n';

    // 生成 SRT 字幕
    const startMin = String(Math.floor(time / 60)).padStart(2, '0');
    const startSec = String(Math.floor(time % 60)).padStart(2, '0');
    const endTime = time + s.duration;
    const endMin = String(Math.floor(endTime / 60)).padStart(2, '0');
    const endSec = String(Math.floor(endTime % 60)).padStart(2, '0');
    srtContent += `${s.id}\n${startMin}:${startSec}:00 --> ${endMin}:${endSec}:00\n${s.narration}\n\n`;
    time = endTime;
  }

  // 配音文本
  fs.writeFileSync(path.join(audioDir, safeName + '_tts.txt'), ttsScript, 'utf8');
  console.log('✅ 配音文本已导出: audio/' + safeName + '_tts.txt');

  // SRT 字幕
  fs.writeFileSync(path.join(audioDir, safeName + '.srt'), srtContent, 'utf8');
  console.log('✅ 字幕文件已导出: audio/' + safeName + '.srt');

  // 配音配置文件（方便后面加 TTS）
  const voiceConfig = {
    textFile: 'audio/' + safeName + '_tts.txt',
    outputFile: 'audio/' + safeName + '.mp3',
    voice: 'zh-CN-XiaoxiaoNeural',
    rate: '+0%',
    pitch: '+0Hz',
    scenes: script.scenes.map(s => ({
      text: s.narration,
      duration: s.duration
    }))
  };
  fs.writeFileSync(path.join(audioDir, safeName + '_voice.json'), JSON.stringify(voiceConfig, null, 2), 'utf8');
  console.log('✅ 配音配置文件: audio/' + safeName + '_voice.json');
}

// ── 输出完整报告 ──
function printSummary(script, safeName) {
  console.log('\n═══════════════════════════════');
  console.log('📋 视频制作工作流完成');
  console.log('═══════════════════════════════\n');
  console.log('生成的素材：');
  console.log('  📄 脚本:       scripts/' + safeName + '.json');
  console.log('  🔊 配音文本:   audio/' + safeName + '_tts.txt');
  console.log('  📝 字幕:       audio/' + safeName + '.srt');
  console.log('  🎬 剪映草稿:   capcut/' + safeName + '/draft_content/\n');

  console.log('使用方式：');
  console.log('  方式1 — 剪映：');
  console.log('    打开剪映 → 导入 → 导入草稿 → 选择 capcut 目录');
  console.log('    剪映自带配音功能，直接点"文本朗读"\n');
  console.log('  方式2 — 手动制作：');
  console.log('    1. 把 tts.txt 复制到剪映/配音软件自动朗读');
  console.log('    2. 导入 srt 字幕');
  console.log('    3. 按画面描述找素材\n');
  console.log('  方式3 — ElevenLabs（效果最好）：');
  console.log('    注册 elevenlabs.io → 获取 API Key');
  console.log('    然后运行: node main.js voice\n');

  console.log('配音文本内容：');
  for (const s of script.scenes) {
    console.log('  [' + s.duration + '秒] ' + s.narration);
  }
  console.log('');
}

// ── 生成配音（ElevenLabs，需用户提供 Key） ──
async function generateAudio(voiceKey) {
  const files = fs.readdirSync(path.join(__dirname, 'audio')).filter(f => f.endsWith('_tts.txt'));
  if (files.length === 0) { console.log('请先生成脚本: node main.js script'); return; }

  const latest = files[files.length - 1];
  const text = fs.readFileSync(path.join(__dirname, 'audio', latest), 'utf8').trim();
  const lines = text.split('\n').filter(l => l.trim());
  const outputFile = path.join(__dirname, 'audio', latest.replace('_tts.txt', '.mp3'));

  console.log('正在生成配音，共 ' + lines.length + ' 句...');

  for (let i = 0; i < lines.length; i++) {
    const data = JSON.stringify({
      text: lines[i],
      voice_settings: { stability: 0.5, similarity_boost: 0.5 }
    });

    await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.elevenlabs.io',
        path: '/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM', // Rachel voice
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': voiceKey,
          'Accept': 'audio/mpeg'
        }
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const mode = i === 0 ? 'w' : 'a';
          if (i === 0) fs.writeFileSync(outputFile, Buffer.concat(chunks));
          else fs.appendFileSync(outputFile, Buffer.concat(chunks));
          process.stdout.write('  ✓ 第' + (i + 1) + '/' + lines.length + '句\n');
          resolve();
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  console.log('\n✅ 配音已生成: ' + outputFile);
}

// ── 主入口 ──
async function main() {
  const args = process.argv.slice(2);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  if (args[0] === 'voice') {
    const voiceKey = getKey('elevenlabs');
    if (!voiceKey) {
      console.log('请设置 ElevenLabs API Key:');
      console.log('  export ELEVENLABS_KEY=sk_xxx');
      console.log('  或添加到 ~/.openclaw/agents/main/agent/models.json 的 providers.elevenlabs.apiKey');
      rl.close();
      return;
    }
    await generateAudio(voiceKey);
    rl.close();
    return;
  }

  console.log('\n=== 🎥 AI 视频工作流 ===\n');

  rl.question('输入视频主题: ', async (topic) => {
    if (!topic.trim()) { console.log('主题不能为空'); rl.close(); return; }

    try {
      const { script, safeName } = await generateScript(topic);
      exportCapCut(script, safeName);
      exportAudioScript(script, safeName);
      printSummary(script, safeName);
    } catch(e) {
      console.error('❌ 出错:', e.message);
    }

    rl.close();
  });
}

main();
