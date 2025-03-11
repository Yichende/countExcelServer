const { exec } = require("child_process");
const axios = require("axios");
const fetch = require("node-fetch");

const sessionStore = new Map();

const buildPrompt = (sessionData) => {
  const cleanTable = sessionData.markdownTable
    .replace(/\t/g, "|") // 转换制表符
    .replace(/\|+/g, "|") // 合并连续分隔符
    .replace(/,/g, "") // 去除数字中的逗号
    .trim();
  return `请严格按照以下步骤处理表格数据：
1. 精准提取问题相关数据列
2. 执行数学运算（加/减/乘/除/...）
3. 生成标准化的Markdown表格

输入格式：
表格数据：
${cleanTable}

待解问题：${sessionData.question}

**标准示例：**
[示例表格]
| 产品   | 单价 | 销量 |
|--------|------|------|
| 手机   | 3000 | 120  |
| 平板   | 2000 | 80   |

[示例问题] 计算总销售额
[正确响应]
| 总销售额 |
|----------|
| 520000   |

**异常处理示例：**
[问题输入]
待解问题：计算平均库存量

[正确响应]
| 平均库存量 |
|------------|
| null       |

**强制规范：**
1.禁止解释计算过程

2.禁止修改原始表头名称

3.数值保留原始精度

4.表格必须包含完整边框

**输出要求：**
✅ 必须生成完整Markdown表格
✅ 表头使用问题原文描述
✅ 数值结果去除单位符号
✅ 不可计算时显示null

请严格按以上要求格式响应。`;
};

// 检测端口是否被占用（服务是否运行）
const checkPortInUse = (port = 11434) => {
  return new Promise((resolve) => {
    const command =
      process.platform === "win32"
        ? `netstat -ano | findstr :${port}`
        : `lsof -i :${port} -t`;

    exec(command, (err, stdout) => {
      if (err) {
        // 命令执行失败视为端口未使用
        resolve(false);
        return;
      }

      // Windows解析
      if (process.platform === "win32") {
        const lines = stdout.trim().split("\n");
        resolve(lines.length > 0);
      }
      // Linux/macOS解析
      else {
        resolve(stdout.trim().length > 0);
      }
    });
  });
};

const terminalController = {
  test: async (req, res) => {
    console.log("Im Controller");
    try {
      const test_id = { name: "test", id: "2331421" };
      res.json(test_id);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  askAi: async (req, res) => {
    // 设置30秒超时
    req.setTimeout(45000, () => {
      res.status(504).send("启动超时");
    });
    const { markdownTable, question } = req.body;
    const prompt = `请严格按照以下步骤处理表格数据：
1. 精准提取问题相关数据列
2. 执行数学运算（加/减/乘/除/...）
3. 生成标准化的Markdown表格

输入格式：
表格数据：
${markdownTable}

待解问题：${question}

**标准示例：**
[示例表格]
| 产品   | 单价 | 销量 |
|--------|------|------|
| 手机   | 3000 | 120  |
| 平板   | 2000 | 80   |

[示例问题] 计算总销售额
[正确响应]
| 总销售额 |
|----------|
| 520000   |

**异常处理示例：**
[问题输入]
待解问题：计算平均库存量

[正确响应]
| 平均库存量 |
|------------|
| null       |

**强制规范：**
1.禁止解释计算过程

2.禁止修改原始表头名称

3.数值保留原始精度

4.表格必须包含完整边框

5.不允许出现内容数值为空白的表格

**输出要求：**
✅ 必须生成且只生成完整Markdown格式表格
✅ 表头使用问题原文描述
✅ 数值结果去除单位符号
✅ 不可计算时显示null

请严格按以上要求格式响应。`;

    try {
      // 带超时配置的请求
      const response = await axios.post(
        "http://localhost:11434/api/generate",
        {
          model: "deepseek-r1:7b",
          prompt: prompt, // 使用动态生成的提示词
          stream: false,
          options: {
            temperature: 0.2, // 降低随机性保证数字准确性
            // num_predict: 150, // 控制最大输出长度
            num_thread: 4, // 明确指定线程数
          },
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 45000, // 45秒超时（比前端稍长）
          validateStatus: (status) => status < 500, // 接受4xx错误
        }
      );

      // 调试日志
      console.log("[Success] 状态码:", response.status);
      // console.log("[Debug] 完整响应:", JSON.stringify(response.data, null, 2));

      // 处理空响应
      if (!response.data?.response) {
        console.warn("[Warning] 收到空响应");
        return res.status(500).json({
          error: "模型返回空响应",
          troubleshooting: [
            "检查模型是否支持JSON格式输出",
            "尝试简化问题结构",
            "查看服务端资源使用情况",
          ],
        });
      }

      // 直接返回原始响应数据
      console.log("[原始响应]", response.data.response);
      res.json({
        success: true,
        rawResponse: response.data.response, // 原始文本响应
        metadata: {
          model: response.data.model,
          createdAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      // 超时专项处理
      if (error.code === "ECONNABORTED") {
        console.error("[超时] 请求耗时超过45秒");
        return res.status(504).json({
          error: "模型响应超时",
          recommendations: [
            "简化输入表格数据量",
            "尝试使用更小规模的模型",
            "检查服务器内存使用情况",
          ],
        });
      }

      // 其他错误处理
      const errorMessage = error.response?.data || error.message;
      console.error("[Error] 完整错误:", errorMessage);
      res.status(500).json({
        error: "模型服务异常",
        details: errorMessage,
        diagnostics: {
          modelStatus: "执行 ollama list 检查模型状态",
          serviceHealth: "确认 ollama serve 运行正常",
        },
      });
    }
  },

  // 初始化会话
  initStreamSession: async (req, res) => {
    try {
      const isOllamaRunning = await checkPortInUse();
      if (!isOllamaRunning) {
        return res.status(503).json({
          error: "SERVICE_UNAVAILABLE",
          message: "Ollama服务未运行",
        });
      }
      // 验证请求体
      if (!req.body?.markdownTable || !req.body?.question) {
        return res.status(400).json({ error: "缺少必要参数" });
      }

      // 生成会话ID
      const sessionId = crypto.randomUUID();

      // 存储会话数据（设置10分钟过期）
      sessionStore.set(sessionId, {
        ...req.body,
        createdAt: Date.now(),
      });

      // 定时清理
      setTimeout(() => sessionStore.delete(sessionId), 600000);

      res.json({
        status: "success",
        sessionId,
      });
    } catch (error) {
      res.status(500).json({
        error: "SERVER_ERROR",
        message: error.message,
      });
    }
  },

  askAiStreamVer: async (req, res) => {
    try {
      const { markdownTable, question } = req.body;
      const sessionId = crypto.randomUUID();

      // 存储会话数据（设置10分钟过期）
      sessionStore.set(sessionId, {
        markdownTable,
        question,
        createdAt: Date.now(),
      });

      // 定时清理
      setTimeout(() => sessionStore.delete(sessionId), 600000);

      res.json({ sessionId });
    } catch (error) {
      res.status(500).json({ error: "会话初始化失败" });
    }
  },

  // 处理流式请求
  handleStream: async (req, res) => {
    const { sessionId } = req.params;
    const sessionData = sessionStore.get(sessionId);
    let isStreamEnded = false; // 状态标志
    // 流引用容器
    let streamRef = null;
    let stream = null;
    // 写锁机制
    let isWriting = false;
    let pendingWrites = [];

    // 验证会话
    if (!sessionData) {
      res.status(404).write('data: {"error":"无效会话ID"}\n\n');
      return res.end();
    }

    // 设置SSE头
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let timeoutTimer;
    // 创建AbortController控制超时
    const controller = new AbortController();

    // 统一响应终止方法
    const safeEnd = (msg) => {
      if (!isStreamEnded) {
        console.log("[连接终止] 原因:", msg); //test!

        isStreamEnded = true;
        pendingWrites = []; // 清空队列

        // 移除所有流监听器
        if (streamRef) {
          streamRef.removeAllListeners();
        }

        clearTimeout(timeoutTimer);
        res.write(msg);

        // 延迟关闭连接
        setTimeout(() => {
          res.end();
          sessionStore.delete(sessionId);
        }, 1000); // 1000ms 延迟
      }
      if (stream && !stream.destroyed) {
        stream.destroy();
      }
    };

    try {
      // Ollama请求
      const response = await axios.post(
        "http://localhost:11434/api/generate",
        {
          model: "deepseek-r1:1.5b",
          prompt: buildPrompt(sessionData),
          stream: true,
          options: {
            temperature: 0.2,
            num_thread: 4,
            repeat_penalty: 1.2, // 降低重复
            top_k: 40, // 增加输出多样性
          },
        },
        {
          responseType: "stream", // 关键配置
          transitional: {
            forcedJSONParsing: false, // 禁用自动JSON解析
          },
          timeout: 45000,
          signal: controller.signal,
        }
      );

      // HTTP状态码检查
      if (response.status !== 200) {
        res.write(
          `event: error\ndata: ${JSON.stringify({
            code: "HTTP_" + response.status,
            details: "Ollama服务异常",
          })}\n\n`
        );
        return res.end();
      }

      // 获取Node.js可读流
      streamRef = response.data;
      stream = response.data;

      // 初始化数据处理器
      let buffer = "";

      // 超时处理
      timeoutTimer = setTimeout(() => {
        safeEnd('event: timeout\ndata: {"msg":"响应超时"}\n\n');
      }, 45000);

      const safeWrite = (data) => {
        if (isStreamEnded || !res.writable) return;

        // 添加队列系统状态检查
        if (typeof isWriting === "undefined") isWriting = false;

        const writeData = () => {
          isWriting = true;
          const canContinue = res.write(data, (err) => {
            if (err) {
              console.error("写入失败:", err);
              safeEnd("error");
            }
            isWriting = false;

            // 处理等待队列
            if (pendingWrites.length > 0) {
              const next = pendingWrites.shift();
              writeData(next);
            }
          });

          if (!canContinue) {
            console.log("流背压出现，暂停写入");
          }
        };

        if (!isWriting) {
          writeData();
        } else {
          pendingWrites.push(data);
        }
      };

      // 修改流处理核心逻辑
      let isFirstChunk = true;

      const processOllamaChunk = (json) => {
        if (json.response && !json.done) {
          // 数据清洗
          const cleanedResponse = json.response
            .replace(/\n/g, "\\n") // 转义换行符
            .replace(/\r/g, "\\r"); // 转义回车符

          // 生成符合 SSE 规范的负载 [!code ++]
          const payload = `data: ${JSON.stringify({
            token: cleanedResponse,
          })}\n\n`;
          safeWrite(payload);

          console.log("[发送数据]", payload); // 调试日志
        }

        if (json.done) {
          safeWrite("data: [DONE]\n\n");
        }
      };

      // 流数据处理
      stream.on("data", (chunk) => {
        if (isStreamEnded) return;
        clearTimeout(timeoutTimer);
        // 超时处理
        timeoutTimer = setTimeout(() => {
          safeEnd('event: timeout\ndata: {"msg":"响应超时"}\n\n');
        }, 45000);

        try {
          buffer += chunk.toString();

          // 按换行符分割数据块（Ollama每行一个JSON）
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // 保留未完成的行

          // 处理每行数据
          lines.forEach((line) => {
            if (!line.trim() || isStreamEnded) return; // 前置状态检查

            try {
              const json = JSON.parse(line);
              // console.log("[Ollama原始响应]", JSON.stringify(json, null, 2)); //test!

              // 处理首块特殊逻辑
              if (isFirstChunk) {
                isFirstChunk = false;
                res.flushHeaders(); // 确保头部发送
              }

              // 有效数据判断
              if (json.response && !json.done) {
                console.log(
                  "[即将发送] 字符数:",
                  json.response.length,
                  "内容:",
                  json.response.replace(/\n/g, "\\n")
                ); // test!
              }

              processOllamaChunk(json);
            } catch (e) {
              console.error("[流解析错误] 原始数据:", line);
            }
          });

          // 内存保护
          if (buffer.length > 1024 * 1024) {
            // 1MB限制
            console.warn("缓冲区溢出风险，清空缓冲");
            buffer = "";
          }
        } catch (error) {
          console.error("数据处理异常:", error);
        }
      });

      // 流结束事件
      stream.once("end", () => {
        pendingWrites = []; // 清空队列
        safeEnd("data: [DONE]\n\n");
      });

      // 流错误处理
      stream.on("error", (err) => {
        safeEnd(
          `event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`
        );
      });
    } catch (error) {
      console.error(
        `event: Ollamaerror\ndata: ${JSON.stringify({
          error: error.message,
        })}\n\n`
      );
      safeEnd();
    }
  },

  startOllama: async (req, res) => {
    // 设置30秒超时
    req.setTimeout(30000, () => {
      res.status(504).send("启动超时");
    });
    function checkAndRestartOllama(callback) {
      console.log("\x1b[36m%s\x1b[0m", "[检测器] 开始进程检查...");
      // 进程检测
      exec('tasklist /FI "IMAGENAME eq ollama.exe"', (error, stdout) => {
        const isRunning = stdout.includes("ollama.exe");

        console.log(
          "\x1b[35m%s\x1b[0m",
          `[检测器] 进程状态: ${isRunning ? "运行中" : "未运行"}`
        );
        console.debug("原始检测结果:\n", stdout); // 调试信息

        const killProcess = () => {
          exec("taskkill /IM ollama.exe /F", (killError) => {
            if (killError) return console.error("终止失败:", killError.message);
            startOllama(callback);
          });
        };

        isRunning ? killProcess() : startOllama(callback);
      });
    }

    function startOllama(callback) {
      console.log("\x1b[36m%s\x1b[0m", "[启动器] 正在启动 Ollama 服务..."); // 青色日志

      // 后台模式启动
      const ollamaProcess = exec(
        "start /B ollama serve",
        { windowsHide: true },
        (error) => {
          if (error) {
            console.error(
              "\x1b[31m%s\x1b[0m",
              "[错误] 进程异常退出:",
              error.message
            ); // 红色错误日志
          }
        }
      );
      // 标准输出监听（白色日志）
      ollamaProcess.stdout.on("data", (data) => {
        console.log("\x1b[37m%s\x1b[0m", `[Ollama 输出] ${data}`);
      });

      // 错误输出监听（黄色日志）
      ollamaProcess.stderr.on("data", (data) => {
        console.log("\x1b[33m%s\x1b[0m", `[Ollama 错误] ${data}`);
      });

      // 添加进程事件监听
      ollamaProcess.on("exit", (code) => {
        const msg = `子进程退出，代码 ${code}`;
        console.log(
          code === 0 ? `\x1b[32m${msg}\x1b[0m` : `\x1b[31m${msg}\x1b[0m`
        );
      });

      // 添加健康检查
      checkServiceHealth(() => {
        console.log("\x1b[32m%s\x1b[0m", "[健康检查] 服务已就绪");
        callback?.();
      });
    }

    function checkServiceHealth(successCallback, retry = 0) {
      if (retry > 30) {
        // 30秒超时
        console.error("\x1b[31m%s\x1b[0m", "[健康检查] 超时：已达最大重试次数");
        return;
      }

      console.log(`[健康检查] 第 ${retry + 1} 次尝试...`);

      fetch("http://localhost:11434/api/tags")
        .then((res) => {
          if (res.ok) {
            console.log("\x1b[32m%s\x1b[0m", "[健康检查] 成功响应");
            successCallback?.();
          } else {
            setTimeout(() => {
              console.warn(
                "\x1b[33m%s\x1b[0m",
                `[健康检查] 收到非200状态码: ${res.status}`
              );
              checkServiceHealth(successCallback, retry + 1), 1000;
            });
          }
        })
        .catch((err) => {
          console.error(
            "\x1b[31m%s\x1b[0m",
            `[健康检查] 请求失败: ${err.message}`
          );
          setTimeout(
            () => checkServiceHealth(successCallback, retry + 1),
            1000
          );
        });
    }

    // 使用示例
    checkAndRestartOllama(() => {
      console.log("服务重启完成");
      res.status(200).json({ message: "Ollama服务启动成功" });
    });
  },

  shutdownOllama: async (req, res) => {
    const isRunningBefore = await checkPortInUse();

    if (!isRunningBefore) {
      return res.json({
        success: true,
        message: "服务未在运行",
        isRunning: false,
      });
    }

    const stopOllama = async () => {
      try {
        const isRunning = await checkPortInUse();
        if (!isRunning) return false;
        const command = "taskkill /IM ollama.exe /F";

        return new Promise((resolve) => {
          exec(command, (err) => {
            if (err) {
              console.error("关闭失败:", err);
              resolve(false);
              return;
            }

            // 二次验证
            setTimeout(async () => {
              const stillRunning = await checkPortInUse();
              resolve(!stillRunning);
            }, 1000); // 给予1秒关闭时间
          });
        });
      } catch (error) {
        console.error("关闭异常:", error);
        return false;
      }
    };

    const shutdownSuccess = await stopOllama();
    const isRunningAfter = await checkPortInUse();

    res.json({
      success: shutdownSuccess && !isRunningAfter,
      message:
        shutdownSuccess && !isRunningAfter
          ? "服务已成功关闭"
          : "关闭操作未完全生效",
      isRunning: isRunningAfter,
    });
  },
};

module.exports = terminalController;
