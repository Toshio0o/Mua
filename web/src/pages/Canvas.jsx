import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Type, Image as ImageIcon, Video, Trash2, ZoomIn, ZoomOut, Maximize, Loader2, Sparkles,
  MousePointer2, ChevronDown, Map as MapIcon, Expand, Upload, Send,
} from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../lib/api.js';
import { useAuth } from '../store/auth.jsx';
import { useToast } from '../components/ui.jsx';

const NODE_W = 260;
const NODE_H = 170;
const IMAGE_SIZES = ['1:1', '3:4', '4:3', '2:3', '3:2', '4:5', '5:4', '9:16', '16:9', '21:9'];
const VIDEO_SIZES = ['9:16', '16:9', '1:1', '3:4', '4:3', '21:9'];
const VIDEO_DURATIONS = [5, 6, 8, 10];

function parseRatio(value) {
  const matched = String(value || '').match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (!matched) return null;
  const width = Number(matched[1]);
  const height = Number(matched[2]);
  return width > 0 && height > 0 ? width / height : null;
}

function frameRatio(n) {
  if (!n) return 1;
  if (n.intent === 'asset' && n.mediaW && n.mediaH) return n.mediaW / n.mediaH;
  if (sends(n)) return parseRatio(n.size) || (n.type === 'video' ? 16 / 9 : 1);
  if (n.mediaW && n.mediaH) return n.mediaW / n.mediaH;
  return parseRatio(n.size) || 3 / 4;
}

function previewBox(n) {
  const ratio = frameRatio(n);
  const width = ratio >= 1.7 ? 320 : ratio <= 0.72 ? 210 : 248;
  const height = Math.round(Math.min(560, Math.max(120, width / ratio)));
  return { width, height, ratio };
}

function nodeW(n) {
  if (!n) return NODE_W;
  if (n.type === 'text') return n.width || NODE_W;
  return previewBox(n).width + 28;
}

function sends(n) {
  if (!n || n.type === 'text') return false;
  if (n.intent === 'asset') return false;
  if (n.intent === 'generate') return true;
  return !n.mediaUrl || !!n.jobId;
}

const nodeH = (n) => {
  if (!n) return NODE_H;
  if (n.type === 'text') return n.height || 184;
  return previewBox(n).height + (sends(n) ? 190 : 86);
};

function mediaFilesFromList(list) {
  return Array.from(list || []).filter((f) => /^(image|video)\//.test(f.type || ''));
}

function mediaFilesFromClipboard(data) {
  if (!data) return [];
  const direct = mediaFilesFromList(data.files);
  if (direct.length) return direct;
  const out = [];
  for (const item of data.items || []) {
    if (item.kind === 'file' && /^(image|video)\//.test(item.type || '')) {
      const file = item.getAsFile();
      if (file) out.push(file);
    }
  }
  return out;
}

function isVideoFile(meta) {
  return (meta?.mime || '').startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(meta?.name || meta?.url || '');
}

let seq = 1;
const newId = () => `n_${Date.now().toString(36)}_${seq++}`;

const defaultDoc = () => ({
  nodes: [
    {
      id: newId(),
      type: 'text',
      x: 360,
      y: 240,
      text: '写下提示词，再从右侧圆点拖到图片或视频节点。',
      label: '文本1',
    },
  ],
  links: [],
});

function pruneLinks(d) {
  const ids = new Set(d.nodes.map((n) => n.id));
  return { ...d, links: (d.links || []).filter((l) => ids.has(l.from) && ids.has(l.to)) };
}

function addLink(doc, from, to) {
  if (!from || !to || from === to) return doc;
  const links = doc.links || [];
  if (links.some((l) => l.from === from && l.to === to)) return doc;
  return { ...doc, links: [...links, { from, to }] };
}

function portPoint(node, side) {
  return {
    x: side === 'out' ? node.x + nodeW(node) : node.x,
    y: node.y + nodeH(node) / 2,
  };
}

function bezier(x1, y1, x2, y2) {
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}

export default function Canvas() {
  const { canvasId } = useParams();
  const nav = useNavigate();
  const { user, refresh } = useAuth();
  const toast = useToast();

  const [doc, setDoc] = useState(defaultDoc);
  const [canvasInfo, setCanvasInfo] = useState(null);
  const [canvasLoaded, setCanvasLoaded] = useState(false);

  const [view, setView] = useState({ x: 0, y: 0, z: 1 });
  const [selected, setSelected] = useState([]);
  const [selectedLink, setSelectedLink] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [price, setPrice] = useState({ videoBase: 10, videoPerSecond: 2, image: 5 });
  const [vpSize, setVpSize] = useState({ w: 800, h: 500 });
  const [draft, setDraft] = useState(null);
  const [menu, setMenu] = useState(null);
  const [selectionRect, setSelectionRect] = useState(null);
  const [canvasGesture, setCanvasGesture] = useState('idle');
  const clipboardKey = `mua_canvas_clipboard_${user?.id || user?.email || 'account'}`;

  const viewportRef = useRef(null);
  const dragRef = useRef(null);
  const viewRef = useRef(view);
  const docRef = useRef(doc);
  const fileRef = useRef(null);
  const uploadTarget = useRef(null);
  const uploadPoint = useRef(null);
  const hoverRef = useRef(null);
  viewRef.current = view;
  docRef.current = doc;

  useEffect(() => {
    let active = true;
    setCanvasLoaded(false);
    setCanvasInfo(null);
    setSelected([]);
    setSelectedLink(null);
    const loadCanvas = canvasId === 'scratch'
      ? api.scratchProject().then(({ project }) => api.canvas(project.canvases[0].id))
      : api.canvas(canvasId);
    loadCanvas.then(({ canvas }) => {
      if (!active) return;
      const document = canvas.document;
      const loadedDoc = Array.isArray(document?.nodes) && Array.isArray(document?.links)
        ? document
        : defaultDoc();
      if (!loadedDoc.nodes.length) loadedDoc.nodes = defaultDoc().nodes;
      setDoc(loadedDoc);
      setView(document?.view && Number.isFinite(document.view.z) ? document.view : { x: 0, y: 0, z: 1 });
      setCanvasInfo(canvas);
      setSelected(loadedDoc.nodes.length ? [loadedDoc.nodes[0].id] : []);
      setCanvasLoaded(true);
    }).catch((error) => {
      if (!active) return;
      toast(error.message, 'error');
      nav('/projects', { replace: true });
    });
    return () => { active = false; };
  }, [canvasId, nav, toast]);

  useEffect(() => {
    api.meta().then((m) => { if (m?.price) setPrice(m.price); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!canvasLoaded) return undefined;
    setSaved(false);
    setSaveError(false);
    const t = setTimeout(() => {
      api.saveCanvas(canvasInfo.id, { document: { ...doc, view } })
        .then(() => setSaved(true))
        .catch((error) => {
          setSaveError(true);
          toast(`画布保存失败：${error.message}`, 'error');
        });
    }, 400);
    return () => clearTimeout(t);
  }, [canvasId, canvasInfo, canvasLoaded, doc, view, toast]);

  const screenToCanvas = (clientX, clientY) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - v.x) / v.z,
      y: (clientY - rect.top - v.y) / v.z,
    };
  };

  const zoomBy = (factor, cx, cy) => {
    setView((v) => {
      const z = Math.min(2.5, Math.max(0.08, v.z * factor));
      const rect = viewportRef.current?.getBoundingClientRect();
      const px = cx ?? (rect ? rect.width / 2 : 0);
      const py = cy ?? (rect ? rect.height / 2 : 0);
      const nx = px - ((px - v.x) / v.z) * z;
      const ny = py - ((py - v.y) / v.z) * z;
      return { x: nx, y: ny, z };
    });
  };

  const onWheel = (e) => {
    e.preventDefault();
    if (e.ctrlKey) {
      const rect = viewportRef.current?.getBoundingClientRect();
      const cx = rect ? e.clientX - rect.left : undefined;
      const cy = rect ? e.clientY - rect.top : undefined;
      zoomBy(Math.exp(-e.deltaY * 0.002), cx, cy);
      return;
    }
    setView((current) => ({ ...current, y: current.y - e.deltaY }));
  };

  useEffect(() => {
    const handleWheel = (event) => {
      const viewport = viewportRef.current;
      if (!viewport || !viewport.contains(event.target)) return;
      onWheel(event);
      event.stopPropagation();
    };
    window.addEventListener('wheel', handleWheel, { capture: true, passive: false });
    return () => window.removeEventListener('wheel', handleWheel, true);
  }, []);

  const onBackgroundDown = (e) => {
    if (e.button === 2) return;
    if (e.button === 1) {
      e.preventDefault();
      setCanvasGesture('pan');
      setMenu(null);
      dragRef.current = {
        mode: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        ox: viewRef.current.x,
        oy: viewRef.current.y,
      };
      return;
    }
    if (e.button !== 0 || e.detail > 1 || (e.target !== e.currentTarget && !e.target.dataset.canvasbg)) return;
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const baseSelection = e.shiftKey ? selected : [];
    setCanvasGesture('select');
    setSelectionRect({ x1: x, y1: y, x2: x, y2: y });
    setSelected(baseSelection);
    setSelectedLink(null);
    setMenu(null);
    dragRef.current = { mode: 'marquee', startX: x, startY: y, baseSelection };
  };

  const onNodeDown = (e, node) => {
    if (e.button === 2) {
      e.preventDefault();
      e.stopPropagation();
      setSelected((current) => e.shiftKey
        ? (current.includes(node.id) ? current.filter((id) => id !== node.id) : [...current, node.id])
        : [node.id]);
      setSelectedLink(null);
      setMenu(null);
      return;
    }
    if (e.button !== 0) return;
    if (e.target.closest('[data-port], textarea, button, input, select')) return;
    e.stopPropagation();
    const multi = e.shiftKey;
    setSelectedLink(null);
    setSelected((sel) => {
      if (multi) return sel.includes(node.id) ? sel.filter((i) => i !== node.id) : [...sel, node.id];
      return sel.includes(node.id) ? sel : [node.id];
    });
    const origins = {};
    const group = multi ? [...new Set([...selected, node.id])] : [node.id];
    for (const n of doc.nodes) {
      if (group.includes(n.id)) origins[n.id] = { x: n.x, y: n.y };
    }
    dragRef.current = {
      mode: 'node',
      id: node.id,
      startX: e.clientX,
      startY: e.clientY,
      nodeX: node.x,
      nodeY: node.y,
      origins,
    };
  };

  const onPortDown = (e, node, side) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const p = screenToCanvas(e.clientX, e.clientY);
    dragRef.current = { mode: 'link', from: node.id, side, x: p.x, y: p.y };
    setDraft({ from: node.id, side, x: p.x, y: p.y });
  };

  const onResizeDown = (e, node) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      mode: 'resize',
      id: node.id,
      startX: e.clientX,
      startY: e.clientY,
      width: nodeW(node),
      height: nodeH(node),
    };
  };

  useEffect(() => {
    const toCanvas = (clientX, clientY) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      const v = viewRef.current;
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - v.x) / v.z,
        y: (clientY - rect.top - v.y) / v.z,
      };
    };
    const finishLink = (e, d) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const marked = el?.closest?.('[data-node-id]');
      const targetId = marked?.getAttribute('data-node-id');
      if (!targetId) {
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect || e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
        const x = Math.min(Math.max(8, e.clientX - rect.left), rect.width - 188);
        const y = Math.min(Math.max(8, e.clientY - rect.top), rect.height - 196);
        setMenu({ x, y, point: toCanvas(e.clientX, e.clientY), link: { from: d.from, side: d.side } });
        setSelected([]);
        setSelectedLink(null);
        return;
      }
      if (targetId === d.from) return;
      const from = d.side === 'in' ? targetId : d.from;
      const to = d.side === 'in' ? d.from : targetId;
      if (from === to) return;
      setDoc((prev) => addLink(prev, from, to));
      setSelectedLink({ from, to });
      setSelected([to]);
    };
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.mode === 'pan') {
        setView((v) => ({ ...v, x: d.ox + (e.clientX - d.startX), y: d.oy + (e.clientY - d.startY) }));
        return;
      }
      if (d.mode === 'marquee') {
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const bounds = {
          left: Math.min(d.startX, x),
          top: Math.min(d.startY, y),
          right: Math.max(d.startX, x),
          bottom: Math.max(d.startY, y),
        };
        setSelectionRect({ x1: d.startX, y1: d.startY, x2: x, y2: y });
        const v = viewRef.current;
        const hits = docRef.current.nodes.filter((node) => {
          const left = v.x + node.x * v.z;
          const top = v.y + node.y * v.z;
          const right = left + nodeW(node) * v.z;
          const bottom = top + nodeH(node) * v.z;
          return left <= bounds.right && right >= bounds.left && top <= bounds.bottom && bottom >= bounds.top;
        }).map((node) => node.id);
        setSelected([...new Set([...d.baseSelection, ...hits])]);
        return;
      }
      if (d.mode === 'link') {
        const p = toCanvas(e.clientX, e.clientY);
        setDraft({ from: d.from, side: d.side, x: p.x, y: p.y });
        return;
      }
      if (d.mode === 'resize') {
        const z = viewRef.current.z || 1;
        const width = Math.min(720, Math.max(220, d.width + (e.clientX - d.startX) / z));
        const height = Math.min(720, Math.max(184, d.height + (e.clientY - d.startY) / z));
        setDoc((prev) => ({
          ...prev,
          nodes: prev.nodes.map((n) => n.id === d.id ? { ...n, width, height } : n),
        }));
        return;
      }
      if (d.mode === 'node') {
        const z = viewRef.current.z || 1;
        const cdx = (e.clientX - d.startX) / z;
        const cdy = (e.clientY - d.startY) / z;
        setDoc((prev) => ({
          ...prev,
          nodes: prev.nodes.map((n) => {
            if (d.origins?.[n.id]) return { ...n, x: d.origins[n.id].x + cdx, y: d.origins[n.id].y + cdy };
            if (n.id === d.id) return { ...n, x: d.nodeX + cdx, y: d.nodeY + cdy };
            return n;
          }),
        }));
      }
    };
    const onUp = (e) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (d?.mode === 'link') finishLink(e, d);
      if (d?.mode === 'marquee') setSelectionRect(null);
      setCanvasGesture('idle');
      setDraft(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'c') {
        const nodes = doc.nodes.filter((node) => selected.includes(node.id));
        if (!nodes.length) return;
        e.preventDefault();
        const ids = new Set(nodes.map((node) => node.id));
        const links = (doc.links || []).filter((link) => ids.has(link.from) && ids.has(link.to));
        try {
          localStorage.setItem(clipboardKey, JSON.stringify({ version: 1, nodes, links }));
          toast(`已复制 ${nodes.length} 个节点，可切换画布粘贴`, 'ok');
        } catch {
          toast('复制失败，浏览器本地存储空间不足', 'error');
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedLink && !selected.length) {
          e.preventDefault();
          setDoc((d) => ({
            ...d,
            links: (d.links || []).filter((l) => !(l.from === selectedLink.from && l.to === selectedLink.to)),
          }));
          setSelectedLink(null);
          return;
        }
        if (!selected.length) return;
        e.preventDefault();
        setDoc((d) => pruneLinks({ ...d, nodes: d.nodes.filter((n) => !selected.includes(n.id)) }));
        setSelected([]);
        setSelectedLink(null);
      }
      if (e.key === 'Escape') {
        setSelected([]);
        setSelectedLink(null);
        setMenu(null);
        setSelectionRect(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, selectedLink, doc, clipboardKey, toast]);

  const centerPoint = () => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return screenToCanvas(
      (rect?.left ?? 0) + (viewportRef.current?.clientWidth ?? 400) / 2,
      (rect?.top ?? 0) + (viewportRef.current?.clientHeight ?? 300) / 2
    );
  };

  const pasteCopiedNodes = () => {
    let copied;
    try { copied = JSON.parse(localStorage.getItem(clipboardKey) || 'null'); } catch { copied = null; }
    if (!Array.isArray(copied?.nodes) || !copied.nodes.length) return false;
    const idMap = new Map(copied.nodes.map((node) => [node.id, newId()]));
    const bounds = copied.nodes.reduce((box, node) => ({
      minX: Math.min(box.minX, node.x || 0),
      minY: Math.min(box.minY, node.y || 0),
      maxX: Math.max(box.maxX, (node.x || 0) + nodeW(node)),
      maxY: Math.max(box.maxY, (node.y || 0) + nodeH(node)),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const center = centerPoint();
    const offsetX = center.x - (bounds.maxX - bounds.minX) / 2 - bounds.minX;
    const offsetY = center.y - (bounds.maxY - bounds.minY) / 2 - bounds.minY;
    const nodes = copied.nodes.map((node) => ({
      ...node,
      id: idMap.get(node.id),
      x: Math.round((node.x || 0) + offsetX),
      y: Math.round((node.y || 0) + offsetY),
    }));
    const links = (copied.links || [])
      .filter((link) => idMap.has(link.from) && idMap.has(link.to))
      .map((link) => ({ ...link, from: idMap.get(link.from), to: idMap.get(link.to) }));
    setDoc((current) => ({ ...current, nodes: [...current.nodes, ...nodes], links: [...(current.links || []), ...links] }));
    setSelected(nodes.map((node) => node.id));
    setSelectedLink(null);
    setMenu(null);
    toast(`已粘贴 ${nodes.length} 个节点`, 'ok');
    return true;
  };

  const addNode = (type, extra = {}, point) => {
    const center = point || centerPoint();
    const n = {
      id: newId(),
      type,
      intent: extra.intent || (type === 'text' ? 'input' : 'generate'),
          x: Math.round(center.x - nodeW({ type, intent: extra.intent || (type === 'text' ? 'input' : 'generate'), size: type === 'video' ? '16:9' : '1:1' }) / 2),
      y: Math.round(center.y - 36),
      text: type === 'text' ? '在这里写下提示词' : '',
      label: extra.label || (type === 'text' ? '文本' : type === 'image' ? '制作图片' : '制作视频'),
      size: type === 'video' ? '16:9' : '1:1',
      duration: 5,
      status: 'idle',
    };
    setDoc((d) => ({ ...d, nodes: [...d.nodes, n] }));
    setSelected([n.id]);
    setSelectedLink(null);
    setMenu(null);
    return n.id;
  };

  const connectCreatedNode = (nodeId, link) => {
    if (!link) return;
    const from = link.side === 'in' ? nodeId : link.from;
    const to = link.side === 'in' ? link.from : nodeId;
    setDoc((d) => addLink(d, from, to));
    setSelectedLink({ from, to });
    setSelected([nodeId]);
  };

  const removeSelected = () => {
    if (selectedLink && !selected.length) {
      setDoc((d) => ({
        ...d,
        links: (d.links || []).filter((l) => !(l.from === selectedLink.from && l.to === selectedLink.to)),
      }));
      setSelectedLink(null);
      return;
    }
    setDoc((d) => pruneLinks({ ...d, nodes: d.nodes.filter((n) => !selected.includes(n.id)) }));
    setSelected([]);
    setSelectedLink(null);
  };

  const fitView = () => {
    if (!doc.nodes.length) return setView({ x: 0, y: 0, z: 1 });
    const minX = Math.min(...doc.nodes.map((n) => n.x));
    const minY = Math.min(...doc.nodes.map((n) => n.y));
    const maxX = Math.max(...doc.nodes.map((n) => n.x + nodeW(n)));
    const maxY = Math.max(...doc.nodes.map((n) => n.y + nodeH(n)));
    const rect = viewportRef.current?.getBoundingClientRect();
    const w = rect?.width ?? 800;
    const h = rect?.height ?? 500;
    const z = Math.min(1.4, Math.max(0.08, Math.min(w / (maxX - minX + 160), h / (maxY - minY + 160))));
    setView({
      x: w / 2 - ((minX + maxX) / 2) * z,
      y: h / 2 - ((minY + maxY) / 2) * z,
      z,
    });
  };

  const uploadMedia = async (fileList, point, targetId) => {
    const files = mediaFilesFromList(fileList).slice(0, 6);
    if (!files.length) return toast('请粘贴或选择图片、视频文件', 'error');
    setUploading(true);
    try {
      const out = await api.upload(files);
      const created = out.files || [];
      if (!created.length) throw new Error('没有收到文件');
      const base = point || hoverRef.current || centerPoint();
      const makeAsset = (f, i, origin) => {
        const video = isVideoFile(f);
        return {
          id: newId(),
          type: video ? 'video' : 'image',
          intent: 'asset',
          x: Math.round((origin?.x ?? base.x) - NODE_W / 2),
          y: Math.round((origin?.y ?? base.y) - 40 + i * 230),
          text: f.name || '',
          label: video ? '视频素材' : '图片素材',
          mediaUrl: f.url,
          status: 'done',
        };
      };
      if (targetId) {
        const [first, ...rest] = created;
        const host = doc.nodes.find((n) => n.id === targetId);
        const firstVideo = isVideoFile(first);
        const extras = rest.map((f, i) => makeAsset(f, i + 1, host || base));
        setDoc((d) => ({
          ...d,
          nodes: [
            ...d.nodes.map((n) => n.id === targetId ? {
              ...n,
              type: firstVideo ? 'video' : 'image',
              intent: 'asset',
              mediaUrl: first.url,
              mediaW: 0,
              mediaH: 0,
              text: first.name || n.text,
              status: 'done',
              label: firstVideo ? '视频素材' : '图片素材',
            } : n),
            ...extras,
          ],
        }));
      } else {
        const nodes = created.map((f, i) => makeAsset(f, i, base));
        setDoc((d) => ({
          ...d,
          nodes: [...d.nodes, ...nodes],
        }));
        setSelected(nodes.map((n) => n.id));
      }
      toast('素材已放上画布', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setUploading(false);
      uploadTarget.current = null;
      uploadPoint.current = null;
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const openPicker = (accept, point, targetId) => {
    uploadTarget.current = targetId || null;
    uploadPoint.current = point || null;
    if (fileRef.current) {
      fileRef.current.accept = accept;
      fileRef.current.click();
    }
    setMenu(null);
  };

  useEffect(() => {
    const onPaste = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;
      const files = mediaFilesFromClipboard(e.clipboardData);
      if (files.length) {
        e.preventDefault();
        uploadMedia(files, hoverRef.current || centerPoint(), null);
        return;
      }
      if (pasteCopiedNodes()) e.preventDefault();
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const generateNode = async (nodeId) => {
    const node = doc.nodes.find((n) => n.id === nodeId);
    if (!node || !sends(node)) return;
    const mode = node.type === 'video' ? 'video' : 'image';
    const sizes = mode === 'video' ? VIDEO_SIZES : IMAGE_SIZES;
    const size = sizes.includes(node.size) ? node.size : (mode === 'video' ? '16:9' : '1:1');
    const duration = VIDEO_DURATIONS.includes(Number(node.duration)) ? Number(node.duration) : 5;
    const incoming = doc.nodes.filter((n) => (doc.links || []).some((l) => l.from === n.id && l.to === nodeId));
    const own = (node.text || '').trim();
    const fromText = incoming.filter((n) => n.type === 'text' && n.text?.trim()).map((n) => n.text.trim());
    const finalPrompt = [own, ...fromText.filter((t) => t !== own)].filter(Boolean).join('\n');
    if (finalPrompt.length < 2) return toast('先在节点里写提示词，或连入一个文本节点', 'error');
    const cost = mode === 'image'
      ? Number(price.image)
      : Number(price.videoBase) + Number(price.videoPerSecond) * duration;
    if ((user?.credits ?? 0) < cost) return toast(`积分不足，本次需要 ${cost}`, 'error');
    const images = [];
    for (const n of incoming) {
      if (n.type === 'image' && n.mediaUrl && !images.includes(n.mediaUrl)) images.push(n.mediaUrl);
    }

    setBusy(true);
    try {
      const body = {
        prompt: finalPrompt,
        size,
        images: images.slice(0, 3),
        projectId: canvasInfo.projectId,
        canvasId: canvasInfo.id,
      };
      const { job } = mode === 'image'
        ? await api.createImage(body)
        : await api.createVideo({ ...body, duration });
      setDoc((d) => ({
        ...d,
        nodes: d.nodes.map((n) => n.id === nodeId ? {
          ...n,
          intent: 'generate',
          text: own || n.text,
          size,
          duration,
          jobId: job.id,
          status: 'running',
          progress: job.progress || 0,
          error: null,
          mediaUrl: null,
        } : n),
      }));
      setSelected([nodeId]);
      toast(mode === 'image' ? '图片任务已提交' : '视频任务已提交', 'ok');
      refresh();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const patchNode = (id, patch) => {
    setDoc((d) => ({ ...d, nodes: d.nodes.map((n) => n.id === id ? { ...n, ...patch } : n) }));
  };

  const openMenuAt = (e) => {
    if (e.target.closest('[data-node-id], button, textarea, input, select')) return;
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.min(Math.max(8, e.clientX - rect.left), rect.width - 188);
    const y = Math.min(Math.max(8, e.clientY - rect.top), rect.height - 196);
    setMenu({ x, y, point: screenToCanvas(e.clientX, e.clientY) });
    setSelected([]);
    setSelectedLink(null);
  };

  const syncJobs = useCallback(async () => {
    const running = doc.nodes.filter((n) => n.jobId && n.status === 'running');
    if (!running.length) return;
    const results = await Promise.all(
      running.map(async (n) => {
        try { return { id: n.id, job: (await api.job(n.jobId)).job }; } catch { return null; }
      })
    );
    setDoc((d) => ({
      ...d,
      nodes: d.nodes.map((n) => {
        const hit = results.find((r) => r?.id === n.id)?.job;
        if (!hit) return n;
        if (hit.status === 'completed') {
          return { ...n, status: 'done', mediaUrl: hit.mediaUrl || hit.result?.localUrl || hit.result?.url };
        }
        if (hit.status === 'failed') return { ...n, status: 'failed', error: hit.error };
        return { ...n, progress: hit.progress };
      }),
    }));
  }, [doc.nodes]);

  useEffect(() => {
    const hasRunning = doc.nodes.some((n) => n.jobId && n.status === 'running');
    if (!hasRunning) return undefined;
    const t = setInterval(syncJobs, 2500);
    return () => clearInterval(t);
  }, [doc.nodes, syncJobs]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setVpSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const nodeById = Object.fromEntries(doc.nodes.map((n) => [n.id, n]));
  const links = (doc.links || []).filter((l) => nodeById[l.from] && nodeById[l.to]);

  const draftPath = (() => {
    if (!draft) return null;
    const n = nodeById[draft.from];
    if (!n) return null;
    const p = portPoint(n, draft.side);
    return draft.side === 'in'
      ? bezier(draft.x, draft.y, p.x, p.y)
      : bezier(p.x, p.y, draft.x, draft.y);
  })();

  if (!canvasLoaded || !canvasInfo) {
    return <div className="grid h-full min-h-64 place-items-center"><Loader2 size={24} className="animate-spin text-brand-500" /></div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="frost sticky top-0 z-30 flex shrink-0 items-center justify-between gap-4 border-b border-[#e6eaf2] px-7 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <button
            type="button"
            onClick={() => nav(canvasInfo.isScratch ? '/scratch' : `/projects/${canvasInfo.projectId}`)}
            className="mt-1 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-[#e6eaf2] bg-white px-3 text-[12px] font-medium text-[#3c4458] transition hover:border-brand-400/40 hover:text-brand-500"
          >
            <ArrowLeft size={14} /> 返回{canvasInfo.isScratch ? '画布列表' : '项目'}
          </button>
          <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-mist-400">
            {canvasInfo.isScratch ? (
              <button onClick={() => nav('/scratch')} className="transition hover:text-brand-500">Mua 画布</button>
            ) : (
              <button onClick={() => nav(`/projects/${canvasInfo.projectId}`)} className="transition hover:text-brand-500">{canvasInfo.projectName}</button>
            )}
            <span>/</span>
            <span>{canvasInfo.name}</span>
          </div>
          <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight text-[#171a24]">
            {canvasInfo.name}
            <span className="h-2 w-2 rounded-full bg-brand-400 shadow-[0_0_10px_rgba(91,108,255,.65)]" />
          </h1>
          <p className="mt-1 text-[12.5px] text-mist-400">左键选择或框选，中键拖动画布，Ctrl+滚轮缩放，普通滚轮上下移动</p>
          </div>
        </div>
        <span className="flex items-center gap-1.5 text-[11.5px] text-mist-400">
          <span className={clsx('h-1.5 w-1.5 rounded-full', saveError ? 'bg-rose-400' : saved ? 'bg-brand-400' : 'bg-mist-400')} />
          {saveError ? '保存失败' : saved ? '已自动保存' : '保存中'}
        </span>
      </div>

      <div className="relative mx-5 mb-5 min-h-0 flex-1 overflow-hidden rounded-2xl border border-[#e6eaf2] bg-white shadow-[0_18px_40px_-30px_rgba(40,50,90,.45)]">
        <div
          ref={viewportRef}
          data-canvasbg="1"
          onMouseDown={onBackgroundDown}
          onDoubleClick={openMenuAt}
          onMouseMove={(e) => { hoverRef.current = screenToCanvas(e.clientX, e.clientY); }}
          onDragOver={(e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); }}
          onDrop={(e) => {
            e.preventDefault();
            uploadMedia(e.dataTransfer.files, screenToCanvas(e.clientX, e.clientY), null);
          }}
          onDragStartCapture={(e) => {
            if (e.target.closest?.('.canvas-media')) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onContextMenu={(e) => e.preventDefault()}
          className={clsx('dot-grid absolute inset-0 select-none', canvasGesture === 'pan' ? 'cursor-grabbing' : canvasGesture === 'select' ? 'cursor-crosshair' : 'cursor-default')}
          style={{
            backgroundSize: `${22 * view.z}px ${22 * view.z}px`,
            backgroundPosition: `${view.x}px ${view.y}px`,
          }}
        >
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}
          >
            <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
              <defs>
                <linearGradient id="edge-live" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#4f7cff" />
                  <stop offset="55%" stopColor="#7a5cff" />
                  <stop offset="100%" stopColor="#b14cff" />
                </linearGradient>
              </defs>
              {links.map((l) => {
                const a = nodeById[l.from];
                const b = nodeById[l.to];
                const p1 = portPoint(a, 'out');
                const p2 = portPoint(b, 'in');
                const d = bezier(p1.x, p1.y, p2.x, p2.y);
                const on = selectedLink && selectedLink.from === l.from && selectedLink.to === l.to;
                return (
                  <g key={`${l.from}-${l.to}`}>
                    <path
                      d={d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth="14"
                      className="pointer-events-auto cursor-pointer"
                      onMouseDown={(e) => {
                        if (e.button === 1) return;
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        setSelected([]);
                        setSelectedLink(l);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setDoc((prev) => ({
                          ...prev,
                          links: (prev.links || []).filter((x) => !(x.from === l.from && x.to === l.to)),
                        }));
                        setSelectedLink(null);
                      }}
                    />
                    <path
                      d={d}
                      fill="none"
                      stroke={on ? 'url(#edge-live)' : '#7b84a5'}
                      strokeWidth={on ? 2.2 : 1.5}
                      strokeOpacity="0.6"
                    />
                  </g>
                );
              })}
              {draftPath && (
                <path d={draftPath} fill="none" stroke="url(#edge-live)" strokeWidth="2" />
              )}
            </svg>

            {doc.nodes.map((n) => (
              <CanvasNode
                key={n.id}
                node={n}
                active={selected.includes(n.id)}
                onMouseDown={(e) => onNodeDown(e, n)}
                onPortDown={onPortDown}
                onResizeDown={onResizeDown}
                price={price}
                busy={busy}
                onText={(text) => patchNode(n.id, { text })}
                onPatch={(patch) => patchNode(n.id, patch)}
                onSend={() => generateNode(n.id)}
                onUpload={() => openPicker('image/*,video/*', { x: n.x + nodeW(n) / 2, y: n.y + nodeH(n) / 2 }, n.id)}
              />
            ))}
          </div>
          {selectionRect && (
            <div
              className="pointer-events-none absolute z-10 border border-brand-500 bg-brand-500/10"
              style={{
                left: Math.min(selectionRect.x1, selectionRect.x2),
                top: Math.min(selectionRect.y1, selectionRect.y2),
                width: Math.abs(selectionRect.x2 - selectionRect.x1),
                height: Math.abs(selectionRect.y2 - selectionRect.y1),
              }}
            />
          )}
        </div>

        <div className="frost absolute left-4 top-4 z-20 flex items-center gap-1 rounded-full border border-white p-1.5 shadow-lg">
          <span title="左键选择，拖动空白处框选" className="grid h-9 w-9 place-items-center rounded-xl bg-brand-500/10 text-brand-500"><MousePointer2 size={16} /></span>
          <Sep />
          <ToolBtn icon={Type} onClick={() => addNode('text')} title="文本输入节点" />
          <ToolBtn icon={Upload} onClick={() => openPicker('image/*', centerPoint(), null)} title="上传图片节点" />
          <ToolBtn icon={ImageIcon} onClick={() => addNode('image', { intent: 'generate', label: '制作图片' })} title="制作图片节点" />
          <ToolBtn icon={Video} onClick={() => addNode('video', { intent: 'generate', label: '制作视频' })} title="制作视频节点" />
          <Sep />
          <ToolBtn icon={ZoomOut} onClick={() => zoomBy(1 / 1.15)} title="缩小" />
          <button
            onClick={() => setView((v) => ({ ...v, z: 1 }))}
            title="重置为 100%"
            className="flex h-9 min-w-[70px] items-center justify-center gap-1 rounded-full border border-[#e6eaf2] bg-white px-2 font-mono text-[12px] text-mist-200 hover:text-[#171a24]"
          >
            {Math.round(view.z * 100)}% <ChevronDown size={12} className="text-mist-400" />
          </button>
          <ToolBtn icon={ZoomIn} onClick={() => zoomBy(1.15)} title="放大" />
          <Sep />
          <ToolBtn icon={Maximize} onClick={fitView} title="适应画布" />
          <ToolBtn icon={Trash2} onClick={removeSelected} disabled={!selected.length && !selectedLink} danger title="删除选中 (Delete)" />
        </div>

        <span className="pointer-events-none absolute right-4 top-5 z-20 hidden font-mono text-[10px] text-mist-400/70 xl:block">
          右侧圆点拖到另一个节点连线，双击连线删除
        </span>

        {menu && (
          <div
            className="absolute z-30 w-[176px] rounded-2xl border border-[#e6eaf2] bg-white p-1.5 shadow-[0_18px_40px_-24px_rgba(40,50,90,.45)]"
            style={{ left: menu.x, top: menu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {[
              ['上传图片节点', Upload, () => {
                if (!menu.link) return openPicker('image/*', menu.point, null);
                const nodeId = addNode('image', { intent: 'asset', label: '图片素材' }, menu.point);
                connectCreatedNode(nodeId, menu.link);
                openPicker('image/*', menu.point, nodeId);
              }],
              ['文本输入节点', Type, () => connectCreatedNode(addNode('text', { intent: 'input', label: '文本' }, menu.point), menu.link)],
              ['制作图片节点', ImageIcon, () => connectCreatedNode(addNode('image', { intent: 'generate', label: '制作图片' }, menu.point), menu.link)],
              ['制作视频节点', Video, () => connectCreatedNode(addNode('video', { intent: 'generate', label: '制作视频' }, menu.point), menu.link)],
            ].map(([label, Icon, run]) => (
              <button
                key={label}
                type="button"
                onClick={run}
                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[12.5px] text-[#171a24] hover:bg-[#f3efff]"
              >
                <Icon size={14} className="text-brand-500" /> {label}
              </button>
            ))}
          </div>
        )}

        <Minimap nodes={doc.nodes} links={links} view={view} vp={vpSize} />
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(e) => uploadMedia(e.target.files, uploadPoint.current, uploadTarget.current)}
        />
      </div>
    </div>
  );
}

function Sep() {
  return <span className="mx-1 h-5 w-px bg-[#e6eaf2]" />;
}

function ToolBtn({ icon: Icon, onClick, active, disabled, danger, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={clsx(
        'grid h-9 w-9 place-items-center rounded-xl transition disabled:opacity-35',
        active ? 'bg-brand-500/10 text-brand-500' : 'text-mist-300 hover:bg-[#eef0f6] hover:text-[#171a24]',
        danger && 'hover:!text-rose-400'
      )}
    >
      <Icon size={16} />
    </button>
  );
}

function Minimap({ nodes, links, view, vp }) {
  const W = 176;
  const H = 116;
  if (!nodes.length) return null;
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const vx0 = -view.x / view.z;
  const vy0 = -view.y / view.z;
  const vw = vp.w / view.z;
  const vh = vp.h / view.z;
  const minX = Math.min(vx0, ...nodes.map((n) => n.x)) - 40;
  const minY = Math.min(vy0, ...nodes.map((n) => n.y)) - 40;
  const maxX = Math.max(vx0 + vw, ...nodes.map((n) => n.x + nodeW(n))) + 40;
  const maxY = Math.max(vy0 + vh, ...nodes.map((n) => n.y + nodeH(n))) + 40;
  const k = Math.min(W / (maxX - minX), H / (maxY - minY));
  const tx = (x) => (x - minX) * k;
  const ty = (y) => (y - minY) * k;

  return (
    <div className="absolute bottom-5 right-5 z-20 hidden rounded-2xl border border-[#e6eaf2] bg-white/85 p-2.5 shadow-lg backdrop-blur md:block">
      <div className="mb-2 flex items-center justify-between px-0.5">
        <span className="flex items-center gap-1.5 text-[11.5px] text-mist-200">
          <MapIcon size={12} className="text-mist-400" /> 小地图
        </span>
        <Expand size={11} className="text-mist-400" />
      </div>
      <div className="dot-grid relative overflow-hidden rounded-xl" style={{ width: W, height: H, backgroundSize: '10px 10px' }}>
        <svg className="absolute inset-0" width={W} height={H}>
          {links.map((l) => {
            const a = byId[l.from];
            const b = byId[l.to];
            if (!a || !b) return null;
            return (
              <line
                key={`${l.from}-${l.to}`}
                x1={tx(a.x + nodeW(a))}
                y1={ty(a.y + nodeH(a) / 2)}
                x2={tx(b.x)}
                y2={ty(b.y + nodeH(b) / 2)}
                stroke="#8b7cff"
                strokeWidth="1"
              />
            );
          })}
        </svg>
        {nodes.map((n) => (
          <span
            key={n.id}
            className="absolute rounded-[3px] border border-mist-300/40 bg-mist-300/25"
            style={{ left: tx(n.x), top: ty(n.y), width: Math.max(4, nodeW(n) * k), height: Math.max(3, nodeH(n) * k) }}
          />
        ))}
        <span
          className="absolute rounded-[4px] border border-brand-400/70 bg-brand-400/5"
          style={{ left: tx(vx0), top: ty(vy0), width: vw * k, height: vh * k }}
        />
      </div>
    </div>
  );
}

function CanvasNode({ node, active, price, busy, onMouseDown, onPortDown, onResizeDown, onText, onPatch, onSend, onUpload }) {
  const running = node.status === 'running';
  const failed = node.status === 'failed';
  const isText = node.type === 'text';
  const canSend = sends(node);
  const sizes = node.type === 'video' ? VIDEO_SIZES : IMAGE_SIZES;
  const size = sizes.includes(node.size) ? node.size : (node.type === 'video' ? '16:9' : '1:1');
  const duration = VIDEO_DURATIONS.includes(Number(node.duration)) ? Number(node.duration) : 5;
  const cost = node.type === 'video'
    ? Number(price?.videoBase || 10) + Number(price?.videoPerSecond || 2) * duration
    : Number(price?.image || 5);
  const Icon = isText ? Type : node.type === 'image' ? ImageIcon : Video;
  const title = node.label || (isText ? '文本提示词' : node.type === 'image' ? '图片' : '视频');
  const role = isText ? '输入' : canSend ? '生成' : '素材';
  const fileName = node.mediaUrl ? decodeURIComponent(node.mediaUrl.split('/').pop().split('?')[0]) : null;
  const box = previewBox(node);
  const rememberMedia = (el) => {
    const width = el?.videoWidth || el?.naturalWidth;
    const height = el?.videoHeight || el?.naturalHeight;
    if (!width || !height) return;
    if (node.mediaW === width && node.mediaH === height) return;
    onPatch?.({ mediaW: width, mediaH: height });
  };

  return (
    <div
      data-node-id={node.id}
      onMouseDown={onMouseDown}
      style={{ left: node.x, top: node.y, width: nodeW(node), height: isText ? 'auto' : nodeH(node) }}
      className={clsx('glass-node absolute cursor-grab p-3.5 active:cursor-grabbing', active && 'is-active')}
    >
      {['in', 'out'].map((side) => (
        <button
          key={side}
          type="button"
          data-port={side}
          data-node-id={node.id}
          title={side === 'out' ? '从这里拖到另一个节点' : '把另一个节点拖到这里'}
          onMouseDown={(e) => onPortDown(e, node, side)}
          className={clsx(
            'absolute top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 bg-white',
            side === 'in' ? '-left-[8px]' : '-right-[8px]',
            active ? 'border-brand-400' : 'border-mist-300/70',
            'hover:scale-125 hover:border-brand-300'
          )}
        />
      ))}

      <div className="mb-2.5 flex items-center justify-between">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-[#171a24]">
          <Icon size={15} className="text-brand-400" />
          {title}
        </span>
        <span className="rounded-md bg-[#eef0f6] px-1.5 py-0.5 text-[10px] text-mist-300">{role}</span>
      </div>

      {isText ? (
        <textarea
          value={node.text || ''}
          onChange={(e) => onText(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder="写下提示词"
          style={{ height: Math.max(96, nodeH(node) - 88) }}
          className="w-full resize-none rounded-xl border border-[#e6eaf2] bg-[#f7f8fc] px-3 py-2.5 text-[12px] leading-relaxed text-[#171a24] outline-none placeholder:text-mist-400 focus:border-brand-400/40"
        />
      ) : (
        <>
        {canSend && (
          <textarea
            value={node.text || ''}
            onChange={(e) => onText(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            placeholder="提示词，留空则使用连入的文本"
            className="mb-2 h-12 w-full resize-none rounded-xl border border-ink-600 bg-ink-750 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-ink-950 outline-none placeholder:text-mist-400"
          />
        )}
        <div className="relative overflow-hidden rounded-xl bg-ink-700" style={{ width: box.width, height: box.height }}>
          {node.mediaUrl ? (
            node.type === 'video' ? (
              <video src={node.mediaUrl} muted loop playsInline autoPlay draggable={false} onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }} onLoadedMetadata={(e) => rememberMedia(e.currentTarget)} className="canvas-media h-full w-full object-contain" />
            ) : (
              <img src={node.mediaUrl} alt="" draggable={false} onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }} onLoad={(e) => rememberMedia(e.currentTarget)} className="canvas-media h-full w-full select-none object-contain" />
            )
          ) : (
            <div className="grid h-full place-items-center bg-[radial-gradient(circle_at_30%_20%,rgba(122,92,255,.16),transparent_62%)]">
              {running ? (
                <div className="flex items-center gap-1.5 text-[12px] text-brand-300">
                  <Loader2 size={14} className="animate-spin" /> {node.progress || 0}%
                </div>
              ) : failed ? (
                <span className="px-3 text-center text-[11.5px] text-rose-400">{node.error || '生成失败'}</span>
              ) : canSend ? (
                <span className="px-3 text-center text-[11.5px] text-mist-400">写下提示词，或连入文本节点</span>
              ) : node.type === 'image' ? (
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onUpload(); }}
                  className="rounded-full border border-[#e6eaf2] bg-white px-3 py-1.5 text-[11.5px] text-mist-200 hover:border-brand-400/50 hover:text-brand-500"
                >
                  上传图片
                </button>
              ) : (
                <span className="text-[11.5px] text-mist-400">等待素材</span>
              )}
            </div>
          )}
        </div>
        </>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px]">
        {isText ? (
          <span className="flex items-center gap-1.5 text-mist-400">
            <Sparkles size={12} /> 可连到图片或视频
          </span>
        ) : (
          <>
            <span className="truncate text-mist-200" title={node.text}>{fileName || node.text || '未命名'}</span>
            <span className={clsx('flex shrink-0 items-center gap-1', failed ? 'text-rose-300' : running ? 'text-mist-300' : node.mediaUrl ? 'text-brand-300' : 'text-mist-400')}>
              <span className={clsx('h-1.5 w-1.5 rounded-full', failed ? 'bg-rose-400' : running ? 'bg-amber-400' : node.mediaUrl ? 'bg-brand-400' : 'bg-mist-400')} />
              {failed ? '失败' : running ? '生成中' : node.mediaUrl ? '完成' : '空'}
            </span>
          </>
        )}
      </div>

      {canSend && (
        <div className="mt-2.5 flex items-center gap-1.5" onMouseDown={(e) => e.stopPropagation()}>
          <select
            value={size}
            onChange={(e) => onPatch({ size: e.target.value })}
            className="h-8 min-w-0 flex-1 cursor-pointer rounded-lg border border-[#e6eaf2] bg-white px-1.5 font-mono text-[11px] text-[#171a24] outline-none"
            title="比例"
          >
            {sizes.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          {node.type === 'video' && (
            <select
              value={duration}
              onChange={(e) => onPatch({ duration: Number(e.target.value) })}
              className="h-8 w-[58px] cursor-pointer rounded-lg border border-[#e6eaf2] bg-white px-1 font-mono text-[11px] text-[#171a24] outline-none"
              title="时长，最高 10 秒"
            >
              {VIDEO_DURATIONS.map((d) => <option key={d} value={d}>{d}s</option>)}
            </select>
          )}
          <button
            type="button"
            disabled={busy || running}
            onClick={onSend}
            className="mint-btn flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[11.5px] font-semibold disabled:opacity-50"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            发送
            <span className="rounded-md bg-white/20 px-1.5 py-0.5 font-mono text-[10px]">{cost} 积分</span>
          </button>
        </div>
      )}
      {isText && (
        <button
          type="button"
          aria-label="调整文本节点大小"
          title="拖动调整节点大小"
          onMouseDown={(e) => onResizeDown(e, node)}
          className="absolute bottom-1.5 right-1.5 z-20 h-4 w-4 cursor-nwse-resize rounded-sm text-mist-400/60 transition hover:text-brand-500"
        >
          <svg viewBox="0 0 12 12" className="h-full w-full" aria-hidden="true">
            <path d="M10.5 3.5v7h-7M7.5 7.5v3h-3" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      )}
    </div>
  );
}
