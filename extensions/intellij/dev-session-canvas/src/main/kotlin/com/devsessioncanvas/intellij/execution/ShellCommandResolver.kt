package com.devsessioncanvas.intellij.execution

import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.util.Locale

object ShellCommandResolver {
    fun defaultShellPath(environment: Map<String, String> = System.getenv(), osName: String = System.getProperty("os.name")): String {
        val configuredShell = environment["SHELL"]?.takeIf { it.isNotBlank() }
        if (!isWindows(osName) && configuredShell != null) {
            return configuredShell
        }
        if (isWindows(osName)) {
            return firstExistingPath(
                environment["COMSPEC"],
                "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
                "C:\\Windows\\System32\\cmd.exe"
            ) ?: "cmd.exe"
        }
        return firstExistingPath(configuredShell, "/bin/zsh", "/bin/bash", "/bin/sh") ?: "/bin/sh"
    }

    fun defaultWorkingDirectory(basePath: String?): String {
        return basePath?.takeIf { it.isNotBlank() } ?: Paths.get(System.getProperty("user.home", ".")).toString()
    }

    private fun isWindows(osName: String): Boolean = osName.lowercase(Locale.US).contains("win")

    private fun firstExistingPath(vararg candidates: String?): String? {
        return candidates
            .filterNotNull()
            .firstOrNull { Files.exists(Path.of(it)) }
    }
}
