(function () {
  "use strict"

  var control = document.querySelector(".theme-toggle")
  if (!control || !window.remottyTheme) return

  function render() {
    var theme = window.remottyTheme.get()
    var next = theme === "dark" ? "light" : "dark"
    var label = "Use " + next + " theme"
    control.setAttribute("aria-label", label)
    control.setAttribute("title", label)
    control.setAttribute("aria-pressed", String(theme === "light"))
  }

  control.addEventListener("click", function () {
    window.remottyTheme.set(window.remottyTheme.get() === "dark" ? "light" : "dark")
  })
  window.addEventListener("remotty-theme-change", render)
  window.remottyTheme.refresh()
  render()
})()
