export function requireMasterAdmin(req, res, next) {
  const role = req.user?.role;

  if (!role || role !== 'master') {
    return res.status(403).json({
      error: 'Acesso restrito ao administrador master'
    });
  }

  next();
}
