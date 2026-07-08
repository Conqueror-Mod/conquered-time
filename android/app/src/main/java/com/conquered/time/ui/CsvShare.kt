package com.conquered.time.ui

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File
import java.time.LocalDate

/**
 * Write a CSV string to the app's cache and hand it to the Android share sheet
 * via a FileProvider content:// URI (see AndroidManifest provider + file_paths).
 * The file lives only in cache — the OS reclaims it; we also overwrite the same
 * name each export so cache doesn't grow.
 */
object CsvShare {

    fun share(context: Context, csv: String) {
        val dir = File(context.cacheDir, "exports").apply { mkdirs() }
        val file = File(dir, "conquered-time-${LocalDate.now()}.csv")
        file.writeText(csv)

        val uri = FileProvider.getUriForFile(
            context, "${context.packageName}.fileprovider", file
        )
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/csv"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(send, "Export time log").apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        })
    }
}
