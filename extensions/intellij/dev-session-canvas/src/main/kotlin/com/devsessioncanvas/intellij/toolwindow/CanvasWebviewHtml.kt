package com.devsessioncanvas.intellij.toolwindow

object CanvasWebviewHtml {
    fun render(bridge: CanvasBrowserBridge): String {
        val javascript = readResource("/webview/webview.js").escapeClosingScriptTag()
        val stylesheet = readResource("/webview/webview.css")
        val bridgeScript = bridge.postMessageScript("payload")

        return """
            <!doctype html>
            <html lang="en">
            <head>
              <meta charset="UTF-8" />
              <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <title>Dev Session Canvas</title>
              <style>$stylesheet</style>
              <script>
                window.devSessionCanvasPostMessage = function(message) {
                  const payload = JSON.stringify(message);
                  $bridgeScript
                };
              </script>
            </head>
            <body>
              <div id="root"></div>
              <script>$javascript</script>
            </body>
            </html>
        """.trimIndent()
    }

    private fun readResource(path: String): String {
        return CanvasWebviewHtml::class.java.getResourceAsStream(path)
            ?.bufferedReader(Charsets.UTF_8)
            ?.use { it.readText() }
            ?: error("Missing bundled webview resource: $path")
    }

    private fun String.escapeClosingScriptTag(): String = replace("</script", "<\\/script")
}
