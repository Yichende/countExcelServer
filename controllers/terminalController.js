const { exec } = require("child_process");
const axios = require("axios");
const fetch = require("node-fetch");

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

**输出要求：**
✅ 必须生成完整Markdown表格
✅ 表头使用问题原文描述
✅ 数值结果去除单位符号
✅ 不可计算时显示null

请严格按以上要求格式响应。`;

    try {
      // 带超时配置的请求
      const response = await axios.post(
        "http://localhost:11434/api/generate",
        {
          model: "deepseek-r1:1.5b",
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

  askAiStreamVer: async (req, res) => {
    // 配置流式响应头
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // 初始化超时控制
    let timeoutTimer = setTimeout(() => {
      res.status(504).write("data: [超时] 响应时间超过45秒\n\n");
      res.end();
    }, 45000);

    // 添加监控埋点
    res.write(
      `data: ${JSON.stringify({
        _monitor: {
          timestamp: Date.now(),
          memory: process.memoryUsage().rss,
        },
      })}\n\n`
    );

    // 每秒发送心跳包
    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, 1000);

    // 终止心跳
    res.on("close", () => {
      clearInterval(heartbeat);
    });

    try {
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
      
      **输出要求：**
      ✅ 必须生成完整Markdown表格
      ✅ 表头使用问题原文描述
      ✅ 数值结果去除单位符号
      ✅ 不可计算时显示null
      
      请严格按以上要求格式响应。`;

      // 使用fetch API实现流式处理
      const controller = new AbortController();
      const response = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "deepseek-r1:1.5b",
          prompt: prompt,
          stream: true,
          options: {
            temperature: 0.2,
            num_thread: 4,
          },
        }),
        signal: controller.signal,
      });

      // 创建流处理器
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // 流数据处理器
      const processStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              clearTimeout(timeoutTimer);
              res.write("data: [DONE]\n\n");
              res.end();
              return;
            }

            // 重置超时计时器
            clearTimeout(timeoutTimer);
            timeoutTimer = setTimeout(() => {
              controller.abort();
              res.write("data: [超时] 响应时间超过45秒\n\n");
              res.end();
            }, 45000);

            // 处理数据块
            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split("\n");
            buffer = chunks.pop(); // 保留未完成数据

            for (const chunk of chunks) {
              if (chunk.trim()) {
                try {
                  const json = JSON.parse(chunk);
                  // 发送有效数据
                  res.write(
                    `data: ${JSON.stringify({
                      token: json.response,
                      stats: {
                        total_duration: json.total_duration,
                        load_duration: json.load_duration,
                      },
                    })}\n\n`
                  );
                } catch (e) {
                  console.error("JSON解析失败:", e);
                }
              }
            }
          }
        } catch (error) {
          console.error("流处理异常:", error);
          res.write(`data: ${JSON.stringify({ error: "流中断" })}\n\n`);
          res.end();
        }
      };

      await processStream();
    } catch (error) {
      clearTimeout(timeoutTimer);
      if (error.name === "AbortError") {
        res.write("data: [终止] 请求被取消\n\n");
      } else {
        console.error("服务端错误:", error);
        res.write(
          `data: ${JSON.stringify({
            error: "服务异常",
            details: error.message,
          })}\n\n`
        );
      }
      res.end();
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
};

module.exports = terminalController;
