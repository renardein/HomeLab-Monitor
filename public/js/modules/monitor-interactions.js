(function initMonitorInteractionsModule(global) {
    function createManager(deps) {
        let swipeStartX = null;
        let swipeHandlersAttached = false;
        let keyboardNavAttached = false;
        let chromeGestureStartX = null;
        let chromeGestureStartY = null;
        let chromeGestureEdge = null;
        let chromeGestureListenersRegistered = false;
        let viewportMetaOriginalContent = null;
        let pageZoomGuardsAttached = false;

        function resetChromeGestureState() {
            chromeGestureStartX = null;
            chromeGestureStartY = null;
            chromeGestureEdge = null;
        }

        function initChromeGestureGuards() {
            if (chromeGestureListenersRegistered) return;
            chromeGestureListenersRegistered = true;
            function edgeWidthPx() {
                const w = window.innerWidth || 0;
                return Math.min(96, Math.max(44, Math.round(w * 0.14)));
            }
            function onStart(e) {
                if (!deps.getMonitorMode() || !deps.getMonitorDisableChromeGestures()) return;
                const t = e && e.touches && e.touches[0] ? e.touches[0] : null;
                if (!t) return;
                const x = Number(t.clientX) || 0;
                const y = Number(t.clientY) || 0;
                const w = window.innerWidth || 0;
                const edge = edgeWidthPx();
                chromeGestureStartX = x;
                chromeGestureStartY = y;
                chromeGestureEdge = null;
                if (x <= edge) chromeGestureEdge = 'left';
                else if (w > 0 && x >= w - edge) chromeGestureEdge = 'right';
            }
            function onMove(e) {
                if (!deps.getMonitorMode() || !deps.getMonitorDisableChromeGestures() || !chromeGestureEdge) return;
                const t = e && e.touches && e.touches[0] ? e.touches[0] : null;
                if (!t) return;
                const dx = (Number(t.clientX) || 0) - (chromeGestureStartX || 0);
                const dy = (Number(t.clientY) || 0) - (chromeGestureStartY || 0);
                const absDx = Math.abs(dx);
                const absDy = Math.abs(dy);
                const horizontalIntent = absDx > 4 && absDx >= absDy * 0.85;
                const backFromLeft = chromeGestureEdge === 'left' && dx > 4 && horizontalIntent;
                const forwardFromRight = chromeGestureEdge === 'right' && dx < -4 && horizontalIntent;
                if (backFromLeft || forwardFromRight) e.preventDefault();
            }
            function onEnd() { resetChromeGestureState(); }
            document.addEventListener('touchstart', onStart, { passive: true, capture: true });
            document.addEventListener('touchmove', onMove, { passive: false, capture: true });
            document.addEventListener('touchend', onEnd, { passive: true, capture: true });
            document.addEventListener('touchcancel', onEnd, { passive: true, capture: true });
        }

        function applyChromeGestureGuards() {
            const enabled = deps.getMonitorMode() && deps.getMonitorDisableChromeGestures();
            document.body.classList.toggle('chrome-gestures-disabled', enabled);
            if (!enabled) resetChromeGestureState();
        }

        function applyRootLayoutClass(enabled) {
            document.documentElement.classList.toggle('monitor-mode-root', !!enabled);
        }

        function applyViewportPageZoomLock(enabled) {
            let meta = document.querySelector('meta[name="viewport"]');
            if (!meta) {
                meta = document.createElement('meta');
                meta.setAttribute('name', 'viewport');
                document.head.appendChild(meta);
            }
            if (enabled) {
                if (viewportMetaOriginalContent === null) {
                    viewportMetaOriginalContent = meta.getAttribute('content') || 'width=device-width, initial-scale=1.0';
                }
                meta.setAttribute('content', 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
            } else if (viewportMetaOriginalContent !== null) {
                meta.setAttribute('content', viewportMetaOriginalContent);
            }
        }

        function initPageZoomGuards() {
            if (pageZoomGuardsAttached) return;
            pageZoomGuardsAttached = true;
            function blockGestureIfMonitor(e) {
                if (deps.getMonitorMode()) e.preventDefault();
            }
            document.addEventListener('gesturestart', blockGestureIfMonitor, { passive: false });
            document.addEventListener('gesturechange', blockGestureIfMonitor, { passive: false });
            document.addEventListener('gestureend', blockGestureIfMonitor, { passive: false });
            window.addEventListener('wheel', (e) => {
                if (deps.getMonitorMode() && e.ctrlKey) e.preventDefault();
            }, { passive: false });
            document.addEventListener('touchmove', (e) => {
                if (deps.getMonitorMode() && e.touches && e.touches.length > 1) e.preventDefault();
            }, { passive: false, capture: true });
        }

        function destroySwipes() {
            swipeStartX = null;
            swipeHandlersAttached = false;
            const target = document.body;
            if (target._monitorSwipeStart) {
                target.removeEventListener('touchstart', target._monitorSwipeStart);
                target.removeEventListener('touchend', target._monitorSwipeEnd);
                delete target._monitorSwipeStart;
                delete target._monitorSwipeEnd;
            }
            if (target._monitorSwipeMouseStart) {
                target.removeEventListener('mousedown', target._monitorSwipeMouseStart);
                delete target._monitorSwipeMouseStart;
            }
        }

        function initKeyboardNavigation() {
            if (keyboardNavAttached) return;
            document.addEventListener('keydown', (e) => {
                if (!deps.getMonitorMode() || !e) return;
                const target = e.target;
                const tag = target && target.tagName ? String(target.tagName).toUpperCase() : '';
                const isEditable = !!(target && (target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'));
                if (isEditable) return;
                if (e.key === 'ArrowLeft') { e.preventDefault(); deps.onPrev(); return; }
                if (e.key === 'ArrowRight') { e.preventDefault(); deps.onNext(); return; }
                if (e.key === 'Home') { e.preventDefault(); deps.onHome(); return; }
                const combo = deps.captureHotkeyCombo(e);
                if (!combo) return;
                const handled = deps.onHotkeyCombo(combo);
                if (handled) e.preventDefault();
            });
            keyboardNavAttached = true;
        }

        function initSwipes() {
            if (swipeHandlersAttached) return;
            const minDist = 80;
            function onStart(e) {
                if (!deps.getMonitorMode() || deps.isDrawSwipesBlocked()) return;
                swipeStartX = e.touches ? e.touches[0].clientX : e.clientX;
            }
            function onEnd(e) {
                if (!deps.getMonitorMode()) return;
                if (deps.isDrawSwipesBlocked()) { swipeStartX = null; return; }
                if (swipeStartX == null) return;
                const x = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
                const delta = x - swipeStartX;
                if (delta < -minDist) deps.onNext();
                else if (delta > minDist) deps.onPrev();
                swipeStartX = null;
            }
            function mouseStart(e) {
                if (!deps.getMonitorMode() || deps.isDrawSwipesBlocked()) return;
                swipeStartX = e.clientX;
                function mouseEnd(ev) {
                    if (deps.isDrawSwipesBlocked()) { swipeStartX = null; return; }
                    const d = ev.clientX - swipeStartX;
                    if (Math.abs(d) > minDist) (d < 0 ? deps.onNext : deps.onPrev)();
                    document.body.removeEventListener('mouseup', mouseEnd);
                }
                document.body.addEventListener('mouseup', mouseEnd, { once: true });
            }
            document.body._monitorSwipeStart = onStart;
            document.body._monitorSwipeEnd = onEnd;
            document.body._monitorSwipeMouseStart = mouseStart;
            document.body.addEventListener('touchstart', onStart, { passive: true });
            document.body.addEventListener('touchend', onEnd, { passive: true });
            document.body.addEventListener('mousedown', mouseStart);
            swipeHandlersAttached = true;
        }

        return {
            initChromeGestureGuards,
            applyChromeGestureGuards,
            applyRootLayoutClass,
            applyViewportPageZoomLock,
            initPageZoomGuards,
            destroySwipes,
            initKeyboardNavigation,
            initSwipes
        };
    }

    global.MonitorInteractionsModule = { createManager };
})(window);
