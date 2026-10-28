临时诊断：run40696561957 footer 的 Codex 已取得 Stop 和完整回答，但产品状态仍 running；只增加测试模式的 output/poll/input-ack 时间线，保持原五秒断言及业务逻辑。使用同轮 source bundle 的原 native 文件，仅重建带观测的扩展入口。三份独立样本全部保留，acceptance=false，不代证完整门禁。

首轮40700262735因手动重建漏掉profile/admission编译define进入stock路径，原执行观察为空，零模型prompt，不能代证业务。修正从原source selection JSON读取全部define后重新观察。

第二轮40700749341样本1复现：observable.length=0、每约100ms仍更新lastOutput，120ms timer被持续重排；样本2Claude正文包含行内代码反引号而页面正确渲染。修复空活动与已知inline显示语义后，保留原断言和全部三样本继续观察。
