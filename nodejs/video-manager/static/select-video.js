$(document).ready(function () {
  var urlParams = new URLSearchParams(window.location.search);
  var videoSelect = urlParams.get('id');
  $('#selectVideo').select2().val(videoSelect).trigger('change');

  $('#selectVideo').on('change', function () {
    var video = $(this).find(':selected').val();
    window.location.replace(window.location.href.split('?')[0] + '?id=' + video);
  });
});
