'use strict';

/* RSVP — Show/hide guest count based on attendance selection */
(function () {
  var radios = document.querySelectorAll('input[name="attending"]');
  var group  = document.getElementById('guest-count-group');
  if (!group) return;
  function update() {
    var val = document.querySelector('input[name="attending"]:checked');
    group.style.display = (val && val.value === 'yes') ? '' : 'none';
  }
  radios.forEach(function (r) { r.addEventListener('change', update); });
  update();
})();
