package com.conquered.time.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * The five Final Fantasy city palettes, ported from the desktop themes.css
 * (the --bg, --surface, --accent and --text custom properties). Kept in the
 * desktop's picker order: Zanarkand, Memoria, Rabanastre, Treno, Nibelheim.
 */
enum class AppTheme(val id: String, val label: String, val isLight: Boolean) {
    ZANARKAND("zanarkand", "Zanarkand", false),
    MEMORIA("memoria", "Memoria", true),
    RABANASTRE("rabanastre", "Rabanastre", true),
    TRENO("treno", "Treno", false),
    NIBELHEIM("nibelheim", "Nibelheim", false);

    companion object {
        /** Resolve a stored ui_theme id; unknown/absent falls back to Memoria (desktop default). */
        fun fromId(id: String?): AppTheme = entries.firstOrNull { it.id == id } ?: MEMORIA
    }
}

private data class Palette(
    val theme: AppTheme,
    val bg: Long, val surface1: Long, val surface2: Long, val border: Long,
    val accent: Long, val accent2: Long, val onAccent: Long,
    val text: Long, val textMuted: Long, val textBright: Long,
)

private val PALETTES = mapOf(
    AppTheme.MEMORIA to Palette(
        AppTheme.MEMORIA, 0xFFF2F3F9, 0xFFFAFAFD, 0xFFEAEDF6, 0xFFC2C6DE,
        0xFF6D4ED8, 0xFFB44FAD, 0xFFFFFFFF, 0xFF2C2D55, 0xFF5C5E90, 0xFF16163A,
    ),
    AppTheme.ZANARKAND to Palette(
        AppTheme.ZANARKAND, 0xFF05090F, 0xFF0C1420, 0xFF121D30, 0xFF223A63,
        0xFF10D6E8, 0xFF8A7AEC, 0xFF02040A, 0xFFAACFE4, 0xFF7FABCC, 0xFFD6ECF8,
    ),
    AppTheme.RABANASTRE to Palette(
        AppTheme.RABANASTRE, 0xFFF2EBE0, 0xFFF8F2E8, 0xFFE8DEC8, 0xFFC0A880,
        0xFF1E6E78, 0xFFB85828, 0xFFFFFFFF, 0xFF3A2C18, 0xFF6E5030, 0xFF1E1408,
    ),
    AppTheme.TRENO to Palette(
        AppTheme.TRENO, 0xFF0E0B10, 0xFF161219, 0xFF1E1922, 0xFF3C2E44,
        0xFFC8902A, 0xFF8B3A6E, 0xFF09070B, 0xFFB8A8C2, 0xFFC0B0D0, 0xFFDDD0E8,
    ),
    AppTheme.NIBELHEIM to Palette(
        AppTheme.NIBELHEIM, 0xFF0A0C10, 0xFF111418, 0xFF181C22, 0xFF2A3040,
        0xFF5888C8, 0xFFC8D8F0, 0xFFFFFFFF, 0xFF8A96A8, 0xFF606E84, 0xFFC8D4E0,
    ),
)

private fun Palette.toColorScheme(): ColorScheme {
    val base = if (theme.isLight) lightColorScheme() else darkColorScheme()
    return base.copy(
        primary = Color(accent),
        onPrimary = Color(onAccent),
        secondary = Color(accent2),
        onSecondary = Color(onAccent),
        background = Color(bg),
        onBackground = Color(textBright),
        surface = Color(surface1),
        onSurface = Color(textBright),
        surfaceVariant = Color(surface2),
        onSurfaceVariant = Color(textMuted),
        outline = Color(border),
        outlineVariant = Color(border),
    )
}

@Composable
fun ConqueredTimeTheme(
    theme: AppTheme = AppTheme.MEMORIA,
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = PALETTES.getValue(theme).toColorScheme(),
        content = content,
    )
}
