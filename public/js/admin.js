'use strict';

(function () {

  /* Confirm before rejecting a pending photo */
  document.querySelectorAll('.reject-form').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!confirm('Reject and permanently delete this photo? This cannot be undone.')) {
        e.preventDefault();
      }
    });
  });

  /* Confirm before removing an approved photo from the gallery */
  document.querySelectorAll('.delete-form').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!confirm('Remove this photo from the public gallery? This cannot be undone.')) {
        e.preventDefault();
      }
    });
  });

  /* Confirm before deleting an RSVP record */
  document.querySelectorAll('.rsvp-delete-form').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      var nameEl = form.closest('tr') && form.closest('tr').querySelector('td strong');
      var label  = nameEl ? nameEl.textContent.trim() : 'this entry';
      if (!confirm('Permanently delete the RSVP from ' + label + '? This cannot be undone.')) {
        e.preventDefault();
      }
    });
  });

})();
