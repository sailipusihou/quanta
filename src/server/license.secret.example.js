'use strict';

// 核销码签名密钥模板。
//
// 使用方法：把本文件复制为同目录下的 `license.secret.js`（该文件已被 .gitignore 忽略），
// 并填入自己的 32 字节随机密钥（64 位 hex）：
//
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// 也可以用环境变量提供（优先级更高）：QUANTA_LICENSE_SECRET=<64位hex>
//
// 注意：密钥必须保密。公开仓库里只有本模板，没有真实密钥，因此别人无法伪造核销码。

module.exports = {
  secretHex: '请替换为你的 64 位 hex 密钥（32 字节随机数）',
};
