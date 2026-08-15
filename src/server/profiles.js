'use strict';

// 本地多用户档案存储（data/profiles.json + data/avatars/）
// 每个档案 = 一个用户：昵称 + 头像 + 绑定的平台账户 + API Key + 模型，
// 滑动切换档案即一键切换整套配置。

const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./config');

const AVATAR_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

function emptyFile() {
  return { activeProfileId: null, profiles: [] };
}

class ProfileStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.path = path.join(dataDir, 'profiles.json');
    this.avatarsDir = path.join(dataDir, 'avatars');
    fs.mkdirSync(this.avatarsDir, { recursive: true });
    this._load();
  }

  _load() {
    try {
      this.data = JSON.parse(fs.readFileSync(this.path, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
      this.data = emptyFile();
    }
    if (!Array.isArray(this.data.profiles)) this.data.profiles = [];
  }

  _save() {
    fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf8');
  }

  list() {
    return [...this.data.profiles];
  }

  get(id) {
    return this.data.profiles.find((p) => p.id === id) || null;
  }

  active() {
    return this.get(this.data.activeProfileId) || this.data.profiles[0] || null;
  }

  create({ name, accountId, apiKeyId, model, avatar = null }) {
    const p = {
      id: 'pf-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name: String(name || '新用户').slice(0, 20),
      avatar: avatar ? String(avatar).slice(0, 200) : null,
      accountId: accountId || '',
      apiKeyId: apiKeyId || '',
      model: model || '',
      createdAt: Date.now(),
    };
    this.data.profiles.push(p);
    if (!this.data.activeProfileId) this.data.activeProfileId = p.id;
    this._save();
    return p;
  }

  update(id, patch) {
    const p = this.get(id);
    if (!p) return null;
    if (patch.name !== undefined) p.name = String(patch.name || '').slice(0, 20);
    if (patch.avatar !== undefined) p.avatar = patch.avatar ? String(patch.avatar).slice(0, 200) : null;
    if (patch.accountId !== undefined) p.accountId = patch.accountId || '';
    if (patch.apiKeyId !== undefined) p.apiKeyId = patch.apiKeyId || '';
    if (patch.model !== undefined) p.model = patch.model || '';
    this._save();
    return p;
  }

  remove(id) {
    const p = this.get(id);
    this.data.profiles = this.data.profiles.filter((x) => x.id !== id);
    if (this.data.activeProfileId === id) {
      this.data.activeProfileId = this.data.profiles[0] ? this.data.profiles[0].id : null;
    }
    this._save();
    // 删除头像文件
    if (p && p.avatar) {
      try {
        const f = path.join(this.avatarsDir, path.basename(p.avatar));
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {
        /* 忽略 */
      }
    }
  }

  setActive(id) {
    if (!this.get(id)) return false;
    this.data.activeProfileId = id;
    this._save();
    return true;
  }

  // 头像绝对路径（供渲染层拼 file:// URL）
  avatarAbsPath(profile) {
    if (!profile || !profile.avatar) return null;
    return path.join(this.avatarsDir, path.basename(profile.avatar));
  }
}

function createProfileStore() {
  return new ProfileStore(getDataDir());
}

module.exports = { ProfileStore, createProfileStore, AVATAR_EXT };
