(function initMonitorDrawManagerModule(global) {
    function createManager(deps) {
        let pointerBound = false;
        let resizeObserver = null;

        function getCanvasBg() {
            return document.body.classList.contains('monitor-theme-dark') ? '#0f1117' : '#f1f5f9';
        }

        function fillCanvasBackground(ctx, w, h) {
            ctx.save();
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = getCanvasBg();
            ctx.fillRect(0, 0, w, h);
            ctx.restore();
        }

        function resizeCanvas() {
            const canvas = document.getElementById('monitorDrawCanvas');
            const wrap = document.getElementById('monitorDrawCanvasWrap');
            if (!canvas || !wrap) return;
            const w = Math.max(1, Math.floor(wrap.clientWidth));
            const h = Math.max(1, Math.floor(wrap.clientHeight));
            if (canvas.width === w && canvas.height === h) return;

            const prev = document.createElement('canvas');
            prev.width = canvas.width;
            prev.height = canvas.height;
            const had = canvas.width > 0 && canvas.height > 0;
            if (had) prev.getContext('2d').drawImage(canvas, 0, 0);

            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (had) ctx.drawImage(prev, 0, 0);
            else fillCanvasBackground(ctx, w, h);
        }

        function clearCanvas() {
            const canvas = document.getElementById('monitorDrawCanvas');
            if (!canvas || !canvas.getContext) return;
            const ctx = canvas.getContext('2d');
            fillCanvasBackground(ctx, canvas.width, canvas.height);
        }

        function setEraser(on) {
            deps.setMonitorDrawIsEraser(!!on);
            const eraser = deps.getMonitorDrawIsEraser();
            const pen = document.getElementById('monitorDrawPenBtn');
            const er = document.getElementById('monitorDrawEraserBtn');
            if (pen) {
                pen.classList.toggle('btn-primary', !eraser);
                pen.classList.toggle('btn-outline-secondary', eraser);
            }
            if (er) {
                er.classList.toggle('btn-primary', eraser);
                er.classList.toggle('btn-outline-secondary', !eraser);
            }
        }

        function initScreen() {
            const canvas = document.getElementById('monitorDrawCanvas');
            const wrap = document.getElementById('monitorDrawCanvasWrap');
            if (!canvas || !wrap) return;

            if (!resizeObserver) {
                resizeObserver = new ResizeObserver(() => {
                    if (deps.getMonitorMode() && deps.getMonitorCurrentView() === 'draw') resizeCanvas();
                });
                resizeObserver.observe(wrap);
            }

            if (!pointerBound) {
                pointerBound = true;
                let drawing = false;

                function linePrefs() {
                    const colorEl = document.getElementById('monitorDrawColor');
                    const widthEl = document.getElementById('monitorDrawWidth');
                    const color = colorEl && colorEl.value ? colorEl.value : '#4ade80';
                    const lw = widthEl ? parseInt(widthEl.value, 10) : 8;
                    return { color, lineWidth: Number.isFinite(lw) ? lw : 8 };
                }

                function applyStrokeStyle(ctx) {
                    const p = linePrefs();
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    ctx.lineWidth = p.lineWidth;
                    if (deps.getMonitorDrawIsEraser()) {
                        ctx.globalCompositeOperation = 'destination-out';
                        ctx.strokeStyle = 'rgba(0,0,0,1)';
                    } else {
                        ctx.globalCompositeOperation = 'source-over';
                        ctx.strokeStyle = p.color;
                    }
                }

                function pos(e) {
                    const r = canvas.getBoundingClientRect();
                    const sx = r.width > 0 ? canvas.width / r.width : 1;
                    const sy = r.height > 0 ? canvas.height / r.height : 1;
                    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
                }

                function onDown(e) {
                    if (!deps.getMonitorMode() || deps.getMonitorCurrentView() !== 'draw') return;
                    if (e.button != null && e.button !== 0) return;
                    e.preventDefault();
                    drawing = true;
                    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
                    const ctx = canvas.getContext('2d');
                    applyStrokeStyle(ctx);
                    const { x, y } = pos(e);
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                }

                function onMove(e) {
                    if (!drawing) return;
                    e.preventDefault();
                    const ctx = canvas.getContext('2d');
                    applyStrokeStyle(ctx);
                    const { x, y } = pos(e);
                    ctx.lineTo(x, y);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                }

                function onUp(e) {
                    if (!drawing) return;
                    drawing = false;
                    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
                }

                canvas.addEventListener('pointerdown', onDown);
                canvas.addEventListener('pointermove', onMove);
                canvas.addEventListener('pointerup', onUp);
                canvas.addEventListener('pointercancel', onUp);

                window.addEventListener('resize', () => {
                    if (deps.getMonitorMode() && deps.getMonitorCurrentView() === 'draw') resizeCanvas();
                });
            }

            setEraser(deps.getMonitorDrawIsEraser());

            const swipeChk = document.getElementById('monitorDrawDisableSwipesChk');
            if (swipeChk) {
                try {
                    const v = localStorage.getItem('monitorDrawDisableSwipes');
                    if (v !== null) swipeChk.checked = v === '1';
                } catch (_) {}
                if (!swipeChk._monitorDrawSwipePersistBound) {
                    swipeChk._monitorDrawSwipePersistBound = true;
                    swipeChk.addEventListener('change', () => {
                        try { localStorage.setItem('monitorDrawDisableSwipes', swipeChk.checked ? '1' : '0'); } catch (_) {}
                    });
                }
            }
        }

        return {
            getCanvasBg,
            fillCanvasBackground,
            resizeCanvas,
            clearCanvas,
            setEraser,
            initScreen
        };
    }

    global.MonitorDrawManagerModule = { createManager };
})(window);
