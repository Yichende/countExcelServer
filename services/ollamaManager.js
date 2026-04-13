const { exec } = require("child_process");
const fetch = require("node-fetch");

const OLLMA_URL = "http://localhost:11434";

function checkOllamaRuning() {
  return fetch(`${OLLMA_URL}/api/tags`)
    .then((res) => res.ok)
    .catch(() => false);
}

function startOllama() {
  return new Promise((resolve, reject) => {
    console.log("[Ollama] starting...");

    const cmd =
      process.platform === "win32" ? "start /B ollama serve" : "ollama serve &";

    exec(cmd, (err) => {
      if (err) {
        console.error("[Ollama] start fail", err.message);
        reject(err);
      }
    });

    waitForReady(resolve);
  });
}

function waitForReady(resolve, retry = 0) {
  if (retry > 20) {
    console.error("[Ollama] start timeout");
    return;
  }

  checkOllamaRuning().then((running) => {
    if (running) {
      console.log("[Ollama] is ready");
      resolve();
    } else {
      setTimeout(() => {
        waitForReady(resolve, retry++);
      }, 1000);
    }
  });
}

async function ensureOllama() {
  const running = await checkOllamaRuning();
  if (running) {
    console.log('[Ollama] server running');
    return;
  }
  await startOllama();
}

module.exports = { ensureOllama };
