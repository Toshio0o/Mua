import { Router } from 'express';
import { db, now, uid } from '../db.js';
import { requireAuth } from '../auth.js';

const r = Router();

function cleanName(value, fallback = '') {
  const name = String(value || '').trim().slice(0, 80);
  return name || fallback;
}

function cleanDocument(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.nodes) || !Array.isArray(value.links)) {
    return { nodes: [], links: [], view: { x: 0, y: 0, z: 1 } };
  }
  const document = {
    nodes: value.nodes.slice(0, 2000),
    links: value.links.slice(0, 5000),
    view: value.view && typeof value.view === 'object' ? value.view : { x: 0, y: 0, z: 1 },
  };
  const serialized = JSON.stringify(document);
  if (serialized.length > 12 * 1024 * 1024) throw new Error('画布内容过大，无法保存');
  return { document, serialized };
}

function createProject(userId, name, document = null, isScratch = false) {
  const ts = now();
  const projectId = uid('prj_');
  const canvasId = uid('cv_');
  const serialized = document ? cleanDocument(document).serialized : JSON.stringify({ nodes: [], links: [], view: { x: 0, y: 0, z: 1 } });
  db.prepare('INSERT INTO projects(id,user_id,name,is_scratch,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run(projectId, userId, name, isScratch ? 1 : 0, ts, ts);
  db.prepare('INSERT INTO canvases(id,project_id,user_id,name,document_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run(canvasId, projectId, userId, '主画布', serialized, ts, ts);
  return { projectId, canvasId };
}

function listProjects(userId) {
  const projects = db.prepare('SELECT id,name,created_at,updated_at FROM projects WHERE user_id = ? AND is_scratch = 0 ORDER BY updated_at DESC')
    .all(userId);
  const getCanvases = db.prepare('SELECT id,name,created_at,updated_at FROM canvases WHERE project_id = ? AND user_id = ? ORDER BY updated_at DESC');
  const getJobCount = db.prepare('SELECT COUNT(*) AS count FROM jobs WHERE user_id = ? AND project_id = ?');
  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
    jobCount: getJobCount.get(userId, project.id).count,
    canvases: getCanvases.all(project.id, userId).map((canvas) => ({
      id: canvas.id,
      name: canvas.name,
      createdAt: canvas.created_at,
      updatedAt: canvas.updated_at,
    })),
  }));
}

function ownedProject(userId, id) {
  return db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, userId);
}

function ownedCanvas(userId, id) {
  return db.prepare(`
    SELECT c.*, p.name AS project_name, p.is_scratch
    FROM canvases c JOIN projects p ON p.id = c.project_id
    WHERE c.id = ? AND c.user_id = ? AND p.user_id = ?
  `).get(id, userId, userId);
}

r.post('/bootstrap', requireAuth, (req, res) => {
  if (db.prepare('SELECT COUNT(*) AS count FROM projects WHERE user_id = ?').get(req.user.id).count) {
    return res.json({ projects: listProjects(req.user.id), migrated: false });
  }

  const legacyProjects = Array.isArray(req.body?.legacyProjects) ? req.body.legacyProjects.slice(0, 100) : [];
  const legacyJobProjects = req.body?.legacyJobProjects && typeof req.body.legacyJobProjects === 'object'
    ? Object.entries(req.body.legacyJobProjects).slice(0, 5000)
    : [];
  const legacyDocument = req.body?.legacyDocument || null;
  const idMap = new Map();

  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT 1 FROM projects WHERE user_id = ? LIMIT 1').get(req.user.id)) {
      for (const project of legacyProjects) {
        const oldId = String(project?.id || '');
        const name = cleanName(project?.name);
        if (!oldId || !name || idMap.has(oldId)) continue;
        const created = createProject(req.user.id, name);
        idMap.set(oldId, created.projectId);
      }

      let legacyCanvas = null;
      if (!idMap.size) createProject(req.user.id, '我的项目');
      if (legacyDocument) legacyCanvas = createProject(req.user.id, '零散创作', legacyDocument, true);

      const updateJobProject = db.prepare('UPDATE jobs SET project_id = ? WHERE id = ? AND user_id = ?');
      for (const [jobId, oldProjectId] of legacyJobProjects) {
        const mapped = idMap.get(String(oldProjectId));
        if (mapped && typeof jobId === 'string') updateJobProject.run(mapped, jobId, req.user.id);
      }
      const updateProjects = db.prepare('UPDATE jobs SET project_id = ? WHERE project_id = ? AND user_id = ?');
      for (const [oldId, newId] of idMap) updateProjects.run(newId, oldId, req.user.id);

      if (legacyCanvas && Array.isArray(legacyDocument?.nodes)) {
        const attachCanvasJob = db.prepare('UPDATE jobs SET project_id = ?, canvas_id = ? WHERE id = ? AND user_id = ?');
        for (const node of legacyDocument.nodes) {
          if (typeof node?.jobId === 'string') attachCanvasJob.run(legacyCanvas.projectId, legacyCanvas.canvasId, node.jobId, req.user.id);
        }
      }

      const unassignedJobs = db.prepare('SELECT COUNT(*) AS count FROM jobs WHERE user_id = ? AND project_id IS NULL').get(req.user.id).count;
      if (unassignedJobs) {
        const history = createProject(req.user.id, '历史作品');
        db.prepare('UPDATE jobs SET project_id = ? WHERE user_id = ? AND project_id IS NULL')
          .run(history.projectId, req.user.id);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    return res.status(400).json({ error: error.message || '初始化项目失败' });
  }

  res.json({ projects: listProjects(req.user.id), migrated: true });
});

r.get('/', requireAuth, (req, res) => {
  res.json({ projects: listProjects(req.user.id) });
});

r.get('/scratch', requireAuth, (req, res) => {
  let project = db.prepare('SELECT * FROM projects WHERE user_id = ? AND is_scratch = 1 ORDER BY created_at LIMIT 1').get(req.user.id);
  if (!project) {
    const created = createProject(req.user.id, '零散创作', null, true);
    project = ownedProject(req.user.id, created.projectId);
  }
  let canvases = db.prepare('SELECT id,name,created_at,updated_at FROM canvases WHERE project_id = ? AND user_id = ? ORDER BY updated_at DESC')
    .all(project.id, req.user.id);
  if (!canvases.length) {
    const ts = now();
    const canvasId = uid('cv_');
    db.prepare('INSERT INTO canvases(id,project_id,user_id,name,document_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(canvasId, project.id, req.user.id, '主画布', JSON.stringify({ nodes: [], links: [], view: { x: 0, y: 0, z: 1 } }), ts, ts);
    canvases = db.prepare('SELECT id,name,created_at,updated_at FROM canvases WHERE id = ?').all(canvasId);
  }
  res.json({ project: {
    id: project.id,
    name: project.name,
    isScratch: true,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
    jobCount: db.prepare('SELECT COUNT(*) AS count FROM jobs WHERE user_id = ? AND project_id = ?').get(req.user.id, project.id).count,
    canvases: canvases.map((canvas) => ({ id: canvas.id, name: canvas.name, createdAt: canvas.created_at, updatedAt: canvas.updated_at })),
  } });
});

r.post('/', requireAuth, (req, res) => {
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: '请输入项目名称' });
  const created = createProject(req.user.id, name);
  res.status(201).json({ project: listProjects(req.user.id).find((project) => project.id === created.projectId) });
});

r.patch('/:projectId', requireAuth, (req, res) => {
  const project = ownedProject(req.user.id, req.params.projectId);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: '项目名称不能为空' });
  db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(name, now(), project.id, req.user.id);
  res.json({ project: listProjects(req.user.id).find((item) => item.id === project.id) });
});

r.delete('/:projectId', requireAuth, (req, res) => {
  const project = ownedProject(req.user.id, req.params.projectId);
  if (!project || project.is_scratch) return res.status(404).json({ error: '项目不存在' });

  db.exec('BEGIN IMMEDIATE');
  try {
    // 保留生成记录及结果，将其从已删除文件夹解除关联。
    db.prepare('UPDATE jobs SET project_id = NULL, canvas_id = NULL WHERE user_id = ? AND project_id = ?')
      .run(req.user.id, project.id);
    db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ? AND is_scratch = 0')
      .run(project.id, req.user.id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  res.json({ ok: true });
});

r.post('/:projectId/canvases', requireAuth, (req, res) => {
  const project = ownedProject(req.user.id, req.params.projectId);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const count = db.prepare('SELECT COUNT(*) AS count FROM canvases WHERE project_id = ? AND user_id = ?')
    .get(project.id, req.user.id).count;
  const name = cleanName(req.body?.name, `画布 ${count + 1}`);
  const id = uid('cv_');
  const ts = now();
  db.prepare('INSERT INTO canvases(id,project_id,user_id,name,document_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run(id, project.id, req.user.id, name, JSON.stringify({ nodes: [], links: [], view: { x: 0, y: 0, z: 1 } }), ts, ts);
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(ts, project.id);
  res.status(201).json({ canvas: { id, projectId: project.id, projectName: project.name, name, createdAt: ts, updatedAt: ts } });
});

r.get('/canvases/:canvasId', requireAuth, (req, res) => {
  const canvas = ownedCanvas(req.user.id, req.params.canvasId);
  if (!canvas) return res.status(404).json({ error: '画布不存在' });
  let document;
  try { document = JSON.parse(canvas.document_json); } catch { document = { nodes: [], links: [], view: { x: 0, y: 0, z: 1 } }; }
  res.json({ canvas: {
    id: canvas.id,
    projectId: canvas.project_id,
    projectName: canvas.project_name,
    isScratch: !!canvas.is_scratch,
    name: canvas.name,
    document,
    createdAt: canvas.created_at,
    updatedAt: canvas.updated_at,
  } });
});

r.patch('/canvases/:canvasId', requireAuth, (req, res) => {
  const canvas = ownedCanvas(req.user.id, req.params.canvasId);
  if (!canvas) return res.status(404).json({ error: '画布不存在' });
  const ts = now();
  const name = req.body?.name === undefined ? canvas.name : cleanName(req.body.name);
  if (!name) return res.status(400).json({ error: '画布名称不能为空' });
  let documentJson = canvas.document_json;
  if (req.body?.document !== undefined) {
    try { documentJson = cleanDocument(req.body.document).serialized; }
    catch (error) { return res.status(400).json({ error: error.message }); }
  }
  db.prepare('UPDATE canvases SET name = ?, document_json = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(name, documentJson, ts, canvas.id, req.user.id);
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ? AND user_id = ?')
    .run(ts, canvas.project_id, req.user.id);
  res.json({ canvas: { id: canvas.id, projectId: canvas.project_id, projectName: canvas.project_name, name, updatedAt: ts } });
});

r.delete('/canvases/:canvasId', requireAuth, (req, res) => {
  const canvas = ownedCanvas(req.user.id, req.params.canvasId);
  if (!canvas) return res.status(404).json({ error: '画布不存在' });
  const count = db.prepare('SELECT COUNT(*) AS count FROM canvases WHERE project_id = ? AND user_id = ?')
    .get(canvas.project_id, req.user.id).count;
  if (count <= 1) return res.status(400).json({ error: '项目至少保留一张画布' });
  db.prepare('DELETE FROM canvases WHERE id = ? AND user_id = ?').run(canvas.id, req.user.id);
  db.prepare('UPDATE jobs SET canvas_id = NULL WHERE canvas_id = ? AND user_id = ?').run(canvas.id, req.user.id);
  res.json({ ok: true });
});

export default r;
