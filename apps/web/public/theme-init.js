(function () {
  "use strict"

  var storageKey = "remotty-theme"
  var root = document.documentElement
  var themes = { dark: true, light: true }

  function storedTheme() {
    try {
      var value = window.localStorage.getItem(storageKey)
      return themes[value] ? value : null
    } catch (_) {
      return null
    }
  }

  function updateThemeColor() {
    var meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) return
    var color = window.getComputedStyle(root).getPropertyValue("--theme-color").trim()
    if (color) meta.setAttribute("content", color)
  }

  function applyTheme(theme, persist, notify) {
    var next = themes[theme] ? theme : "dark"
    root.dataset.theme = next
    root.style.colorScheme = next
    if (persist) {
      try { window.localStorage.setItem(storageKey, next) } catch (_) { /* Storage can be unavailable. */ }
    }
    window.requestAnimationFrame(updateThemeColor)
    if (notify) window.dispatchEvent(new CustomEvent("remotty-theme-change", { detail: { theme: next } }))
    return next
  }

  window.remottyTheme = {
    get: function () { return root.dataset.theme === "light" ? "light" : "dark" },
    set: function (theme) { return applyTheme(theme, true, true) },
    refresh: updateThemeColor,
  }

  applyTheme(storedTheme() || "dark", false, false)
  document.addEventListener("DOMContentLoaded", updateThemeColor, { once: true })
})()
