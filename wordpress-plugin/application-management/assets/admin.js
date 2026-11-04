/* Application Management - small admin helpers (no dependencies). */
(function () {
	'use strict';

	// Ask before critical actions: <form data-am-confirm="Message">
	document.addEventListener('submit', function (e) {
		var f = e.target;
		if (f && f.getAttribute && f.hasAttribute('data-am-confirm')) {
			if (!window.confirm(f.getAttribute('data-am-confirm'))) {
				e.preventDefault();
			}
		}
	});

	// "all / none" links in the permissions matrix: <a data-am-toggle="css selector" data-state="all|none">
	document.addEventListener('click', function (e) {
		var a = e.target.closest ? e.target.closest('[data-am-toggle]') : null;
		if (!a) {
			return;
		}
		e.preventDefault();
		var on = a.getAttribute('data-state') === 'all';
		var root = a.closest('form') || document;
		root.querySelectorAll(a.getAttribute('data-am-toggle')).forEach(function (box) {
			if (!box.disabled) {
				box.checked = on;
			}
		});
	});
})();
