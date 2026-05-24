// Vercel Serverless: GET /api/ — 健康检查 + 端点列表
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  res.status(200).json({
    ok: true,
    name: '寿司郎排队 API',
    version: '1.0.0',
    endpoints: {
      '/api/stores': '所有城市门店排队数据',
      '/api/store?id=1012': '单门店详情',
    },
    example: '/api/stores',
  });
};
