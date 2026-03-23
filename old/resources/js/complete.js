var editor = null;
$(document).ready(function() {
editor = CodeMirror.fromTextArea($("#code")[0], {
    lineNumbers: true,
    theme: "default",
    onKeyEvent: function(i, e) {
      // Hook into ctrl-space
      if (e.keyCode == 32 && (e.ctrlKey || e.metaKey) && !e.altKey) {
        e.stop();
        return startComplete();
      }
    }
  });
});  