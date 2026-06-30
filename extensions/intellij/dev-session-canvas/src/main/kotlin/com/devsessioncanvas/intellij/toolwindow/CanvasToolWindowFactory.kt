package com.devsessioncanvas.intellij.toolwindow

import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import java.awt.BorderLayout
import javax.swing.JPanel

class CanvasToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val browser = if (JBCefApp.isSupported()) {
            val browser = JBCefBrowser()
            val bridge = CanvasBrowserBridge(project, browser)
            browser.loadHTML(CanvasWebviewHtml.render(bridge))
            browser to bridge
        } else {
            null
        }

        val component = browser?.first?.component ?: unsupportedJcefPanel()
        val content = ContentFactory.getInstance().createContent(component, "", false)
        browser?.let { (jcefBrowser, bridge) ->
            val contentDisposable = Disposer.newDisposable("Dev Session Canvas Tool Window")
            content.setDisposer(contentDisposable)
            Disposer.register(contentDisposable, bridge)
            Disposer.register(contentDisposable, jcefBrowser)
        }

        toolWindow.contentManager.addContent(content)
    }

    private fun unsupportedJcefPanel(): JPanel {
        return JPanel(BorderLayout()).apply {
            background = JBColor.PanelBackground
            add(
                JBLabel("Dev Session Canvas needs JCEF, but this IDE runtime does not support it."),
                BorderLayout.CENTER
            )
        }
    }
}
