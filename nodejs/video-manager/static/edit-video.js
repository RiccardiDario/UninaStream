$('#myEdit').click(function() {
  var urlParams = new URLSearchParams(window.location.search);
  var videoSelect = urlParams.get('id');
  var abbonamentoCheck = document.getElementById("abbonamentoSwitch").checked;
  $.ajax({
    url: "/media/update-video",
    method: "POST",
    contentType: "application/json",
    data: JSON.stringify({
      video_id: videoSelect,
      abbonamento: abbonamentoCheck
    }),
    success: function (response) {
      window.location.replace(window.location.origin + window.location.pathname);
      console.log(response);
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.log("Updated video failed:", textStatus, errorThrown);
    }
  });
});

$('#myDelete').click(function() {
  var urlParams = new URLSearchParams(window.location.search);
  var videoSelect = urlParams.get('id');
  $.ajax({
    url: "/media/delete-video",
    method: "POST",
    contentType: "application/json",
    data: JSON.stringify({ video_id: videoSelect }),
    success: function (response) {
      window.location.replace(window.location.origin + window.location.pathname);
      console.log(response);
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.log("Deleted video failed:", textStatus, errorThrown);
    }
  });
});
