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

    // 构造结构化提示词
    const prompt = `请分析以下表格数据并回答问题：
    ${markdownTable}
    问题：${question}
    回答时严格返回JSON格式: { "result": "计算结果" }`;

    try {
      // 带超时配置的请求
      const response = await axios.post(
        "http://localhost:11434/api/generate",
        {
          model: "deepseek-r1:1.5b",
          prompt: prompt, // 使用动态生成的提示词
          stream: false,
          options: {
            temperature: 0.3, // 降低随机性保证数字准确性
            // num_predict: 150, // 控制最大输出长度
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

      // 尝试解析JSON
      try {
        const result = JSON.parse(response.data.response.trim());
        res.json(result);
      } catch (parseError) {
        console.error("[JSON解析失败] 原始响应:", response.data.response);
        res.status(500).json({
          error: "响应格式无效",
          invalidResponse: response.data.response,
        });
      }
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
      res.status(200).send("Ollama服务启动成功");
    });
  },
};

module.exports = terminalController;
