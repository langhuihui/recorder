var HISTORY_KEY = 'recentRecordings'
var SHARE_SUFFIX_KEY = 'lastShareSuffix'
var SESSION_KEY = 'lastSession'
var MAX_HISTORY = 10

Page({
  data: {
    statusBarHeight: 20,
    recordingState: 'idle',
    duration: 0,
    currentTime: 0,
    isPlaying: false,
    bgMusicLoaded: false,
    bgMusicFileName: '',
    bgMusicPath: '',
    removedBg: null,
    bgDuration: 0,
    bgCurrentTime: 0,
    bgVolume: 50,
    bgProgressPercent: 0,
    bgSkipStart: 0,
    bgSkipMax: 60,
    shareModalVisible: false,
    shareFileName: '',
    sharePrefix: '',
    shareFilePath: '',
    skipModalVisible: false,
    skipPresets: [0, 3, 5, 10, 15, 30, 60],
    recordingFilePath: '',
    scoreFiles: [],
    removedScores: [],
    recentRecordings: [],
    recentModalVisible: false,
    maxHistory: MAX_HISTORY
  },

  recorderManager: null,
  bgAudioCtx: null,
  playAudioCtx: null,
  timer: null,
  isSeeking: false,
  playbackRafId: null,
  playbackTimer: null,

  onLoad: function () {
    var sysInfo = wx.getSystemInfoSync()
    this.setData({ statusBarHeight: sysInfo.statusBarHeight })

    this._loadRecordings()
    this._restoreSession()
    this.recorderManager = wx.getRecorderManager()

    var self = this
    this.recorderManager.onStart(function () {
      self.setData({
        recordingState: 'recording',
        duration: 0,
        currentTime: 0,
        isPlaying: false,
        recordingFilePath: ''
      })
      self.startDurationTimer()

      if (self.bgAudioCtx) {
        self.bgAudioCtx.seek(self.data.bgSkipStart || 0)
        self.bgAudioCtx.play()
      }
    })

    this.recorderManager.onStop(function (res) {
      self.stopDurationTimer()

      // 只暂停，保留伴奏进度；重置交给「重录」
      if (self.bgAudioCtx) {
        self.bgAudioCtx.pause()
      }

      var recordedDuration = self.data.duration
      if (res && isFinite(res.duration) && res.duration > 0) {
        recordedDuration = res.duration / 1000
      }

      self.setData({
        recordingState: 'stopped',
        recordingFilePath: res.tempFilePath,
        duration: recordedDuration,
        currentTime: 0,
        isPlaying: false
      })

      self.initPlaybackAudio(res.tempFilePath)
      self._archiveRecording(res.tempFilePath, recordedDuration)
    })

    this.recorderManager.onError(function (err) {
      console.error('录音错误:', err)
      wx.showToast({ title: '录音出错，请检查权限', icon: 'none' })
      self.stopDurationTimer()
      self.setData({
        recordingState: 'idle',
        isPlaying: false
      })
    })
  },

  onUnload: function () {
    this.stopDurationTimer()
    this.stopPlaybackProgressLoop()

    if (this.recorderManager) {
      try { this.recorderManager.stop() } catch (e) {}
    }

    if (this.bgAudioCtx) {
      try { this.bgAudioCtx.destroy() } catch (e) {}
      this.bgAudioCtx = null
    }

    if (this.playAudioCtx) {
      try { this.playAudioCtx.destroy() } catch (e) {}
      this.playAudioCtx = null
    }
  },

  startRecording: function () {
    if (!this.recorderManager) return

    if (this.playAudioCtx) {
      this.stopPlaybackProgressLoop()
      try { this.playAudioCtx.stop() } catch (e) {}
      try { this.playAudioCtx.destroy() } catch (e) {}
      this.playAudioCtx = null
    }

    this.setData({
      currentTime: 0,
      isPlaying: false,
      recordingFilePath: ''
    })

    this.recorderManager.start({
      duration: 600000,
      format: 'mp3',
      sampleRate: 44100,
      numberOfChannels: 1,
      encodeBitRate: 192000
    })
  },

  stopRecording: function () {
    if (this.data.recordingState !== 'recording') return
    this.recorderManager.stop()
  },

  resetRecording: function () {
    if (this.playAudioCtx) {
      this.stopPlaybackProgressLoop()
      try { this.playAudioCtx.stop() } catch (e) {}
      try { this.playAudioCtx.destroy() } catch (e) {}
      this.playAudioCtx = null
    }

    // 不删文件：录音可能已经在「最近录音」列表里，删了就找不回来
    this.setData({
      recordingState: 'idle',
      duration: 0,
      currentTime: 0,
      isPlaying: false,
      recordingFilePath: ''
    })

    this._resetBgProgress()
  },

  _resetBgProgress: function () {
    var start = this.data.bgSkipStart || 0

    if (this.bgAudioCtx) {
      try { this.bgAudioCtx.pause() } catch (e) {}
      try { this.bgAudioCtx.seek(start) } catch (e) {}
    }

    var total = this.data.bgDuration
    this.setData({
      bgCurrentTime: start,
      bgProgressPercent: (isFinite(total) && total > 0) ? Math.min(100, (start / total) * 100) : 0
    })
  },

  chooseBgMusic: function () {
    if (this.data.recordingState === 'recording') return

    var self = this
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'],
      success: function (res) {
        var file = res.tempFiles[0]
        var kept = self._keepFile(file.path, 'bgm', 'bg' + self._extOf(file.path, '.mp3'))
        self._loadBgMusic(kept, file.name)
      }
    })
  },

  _loadBgMusic: function (filePath, fileName) {
    var self = this

    if (self.bgAudioCtx) {
      try { self.bgAudioCtx.destroy() } catch (e) {}
    }

    var bgAudio = wx.createInnerAudioContext()
    bgAudio.src = filePath
    bgAudio.loop = false
    bgAudio.volume = self.data.bgVolume / 100
    self.bgAudioCtx = bgAudio

    bgAudio.onCanplay(function () {
      var dur = bgAudio.duration
      if (isFinite(dur) && dur > 0) {
        self.setData({ bgDuration: dur })
        self._updateSkipMax()
      }
    })

    bgAudio.onTimeUpdate(function () {
      var t = bgAudio.currentTime
      var d = bgAudio.duration
      if (!isFinite(t) || t < 0) return

      if (isFinite(d) && d > 0 && d !== self.data.bgDuration) {
        self.setData({ bgDuration: d })
        self._updateSkipMax()
      }

      self._applyBgProgress(t)
    })

    bgAudio.onEnded(function () {
      self.setData({
        bgCurrentTime: self.data.bgDuration || 0,
        bgProgressPercent: 100
      })

      if (self.data.recordingState === 'recording' && self.recorderManager) {
        self.recorderManager.stop()
      }
    })

    bgAudio.onError(function (err) {
      console.error('背景音乐播放错误:', err)
      wx.showToast({ title: '音频文件无法播放', icon: 'none' })
    })

    self.setData({
      bgMusicLoaded: true,
      bgMusicFileName: fileName,
      bgMusicPath: filePath,
      removedBg: null,
      bgDuration: 0,
      bgCurrentTime: 0,
      bgProgressPercent: 0,
      bgSkipStart: 0,
      bgSkipMax: 60
    })

    self._persistSession()
  },

  removeBgMusic: function () {
    if (this.data.recordingState === 'recording') return

    if (this.bgAudioCtx) {
      try { this.bgAudioCtx.stop() } catch (e) {}
      try { this.bgAudioCtx.destroy() } catch (e) {}
      this.bgAudioCtx = null
    }

    this.setData({
      removedBg: this.data.bgMusicPath ? {
        path: this.data.bgMusicPath,
        fileName: this.data.bgMusicFileName,
        skipStart: this.data.bgSkipStart
      } : null,
      bgMusicLoaded: false,
      bgMusicFileName: '',
      bgMusicPath: '',
      bgDuration: 0,
      bgCurrentTime: 0,
      bgProgressPercent: 0,
      bgSkipStart: 0,
      bgSkipMax: 60
    })

    this._persistSession()
  },

  restoreBgMusic: function () {
    if (this.data.recordingState === 'recording') return

    var removed = this.data.removedBg
    if (!removed) return

    var skip = removed.skipStart || 0
    this._loadBgMusic(removed.path, removed.fileName)
    this.setData({ bgSkipStart: skip })
    this._persistSession()
  },

  openHistoryModal: function () {
    if (this.data.recordingState === 'recording') return
    this.setData({ recentModalVisible: true })
  },

  closeHistoryModal: function () {
    this.setData({ recentModalVisible: false })
  },

  loadRecording: function (e) {
    var item = this.data.recentRecordings[Number(e.currentTarget.dataset.index)]
    if (!item) return

    this.stopPlaybackProgressLoop()
    if (this.playAudioCtx) {
      try { this.playAudioCtx.stop() } catch (err) {}
      try { this.playAudioCtx.destroy() } catch (err) {}
      this.playAudioCtx = null
    }

    this.setData({
      recordingState: 'stopped',
      recordingFilePath: item.path,
      duration: item.duration || 0,
      currentTime: 0,
      isPlaying: false,
      recentModalVisible: false
    })

    this.initPlaybackAudio(item.path)
  },

  deleteRecording: function (e) {
    var index = Number(e.currentTarget.dataset.index)
    var item = this.data.recentRecordings[index]
    if (!item) return

    var self = this
    wx.showModal({
      title: '删除这条录音',
      content: (item.bgName ? item.bgName + ' · ' : '') + item.timeLabel
        + '（' + Number(item.duration || 0).toFixed(0) + ' 秒）将被删除',
      success: function (res) {
        if (!res.confirm) return

        var list = self.data.recentRecordings.slice()
        list.splice(index, 1)
        try { wx.getFileSystemManager().unlinkSync(item.path) } catch (err) {}

        var patch = { recentRecordings: list }
        if (!list.length) patch.recentModalVisible = false
        if (self.data.recordingFilePath === item.path) {
          if (self.playAudioCtx) {
            self.stopPlaybackProgressLoop()
            try { self.playAudioCtx.stop() } catch (err2) {}
            try { self.playAudioCtx.destroy() } catch (err2) {}
            self.playAudioCtx = null
          }
          patch.recordingState = 'idle'
          patch.recordingFilePath = ''
          patch.duration = 0
          patch.currentTime = 0
          patch.isPlaying = false
        }

        self.setData(patch)
        self._persistRecordings()
      }
    })
  },

  clearAllRecordings: function () {
    if (this.data.recordingState === 'recording') return

    var list = this.data.recentRecordings || []
    if (!list.length) return

    var self = this
    wx.showModal({
      title: '清空最近录音',
      content: '共 ' + list.length + ' 条录音将被删除，无法恢复',
      confirmText: '清空',
      confirmColor: '#f87171',
      success: function (res) {
        if (!res.confirm) return

        var fs = wx.getFileSystemManager()
        var currentDeleted = false
        for (var i = 0; i < list.length; i++) {
          try { fs.unlinkSync(list[i].path) } catch (e) {}
          if (list[i].path === self.data.recordingFilePath) currentDeleted = true
        }

        var patch = { recentRecordings: [], recentModalVisible: false }

        // 当前载入的那条也被删了，回到待录制状态
        if (currentDeleted) {
          if (self.playAudioCtx) {
            self.stopPlaybackProgressLoop()
            try { self.playAudioCtx.stop() } catch (e) {}
            try { self.playAudioCtx.destroy() } catch (e) {}
            self.playAudioCtx = null
          }
          patch.recordingState = 'idle'
          patch.recordingFilePath = ''
          patch.duration = 0
          patch.currentTime = 0
          patch.isPlaying = false
        }

        self.setData(patch)
        self._persistRecordings()
        wx.showToast({ title: '已清空', icon: 'success' })
      }
    })
  },

  _loadRecordings: function () {
    var list = []
    try {
      list = wx.getStorageSync(HISTORY_KEY) || []
    } catch (e) {}
    if (Object.prototype.toString.call(list) !== '[object Array]') list = []

    var fs = wx.getFileSystemManager()
    var valid = []
    for (var i = 0; i < list.length; i++) {
      var item = list[i]
      if (!item || !item.path) continue
      if (typeof fs.accessSync === 'function') {
        try { fs.accessSync(item.path) } catch (e) { continue }
      }
      valid.push(item)
    }

    this.setData({ recentRecordings: valid })
    if (valid.length !== list.length) this._persistRecordings()
  },

  _persistRecordings: function () {
    try { wx.setStorageSync(HISTORY_KEY, this.data.recentRecordings) } catch (e) {}
  },

  // 把临时文件落到本地存储目录，否则下次打开小程序就找不回来了
  _keepFile: function (tempPath, subDir, name) {
    var fs = wx.getFileSystemManager()
    var dir = wx.env.USER_DATA_PATH + '/' + subDir
    try { fs.mkdirSync(dir, true) } catch (e) {}

    var savedPath = dir + '/' + name
    try {
      fs.saveFileSync(tempPath, savedPath)
      return savedPath
    } catch (e) {
      console.error('文件保存失败，继续使用临时路径:', e)
      return tempPath
    }
  },

  // 落盘文件名必须带扩展名，否则 <image> 认不出格式会渲染成黑块
  _extOf: function (path, fallback) {
    var m = String(path || '').match(/\.[a-zA-Z0-9]+$/)
    if (!m || m[0].length > 6) return fallback || '.jpg'
    return m[0].toLowerCase()
  },

  // 文件名只用 ASCII：USER_DATA_PATH 下带中文的路径，部分机型图片会解不出来
  _scoreSavedName: function (index, name, srcPath) {
    return 'score_' + index + this._extOf(srcPath, '.jpg')
  },

  // 换一批歌谱时清掉旧的，避免本地文件越积越多
  _clearDir: function (subDir) {
    var fs = wx.getFileSystemManager()
    try { fs.rmdirSync(wx.env.USER_DATA_PATH + '/' + subDir, true) } catch (e) {}
  },

  _fileExists: function (path) {
    if (!path) return false
    try {
      wx.getFileSystemManager().accessSync(path)
      return true
    } catch (e) {
      return false
    }
  },

  _persistSession: function () {
    var session = {
      bg: this.data.bgMusicPath ? {
        path: this.data.bgMusicPath,
        fileName: this.data.bgMusicFileName,
        skipStart: this.data.bgSkipStart,
        volume: this.data.bgVolume
      } : null,
      scores: this.data.scoreFiles
    }
    try { wx.setStorageSync(SESSION_KEY, session) } catch (e) {}
  },

  _restoreSession: function () {
    var session = null
    try { session = wx.getStorageSync(SESSION_KEY) || null } catch (e) {}
    if (!session) return

    if (session.bg && this._fileExists(session.bg.path)) {
      if (isFinite(session.bg.volume)) {
        this.setData({ bgVolume: session.bg.volume })
      }
      this._loadBgMusic(session.bg.path, session.bg.fileName)
      this.setData({ bgSkipStart: session.bg.skipStart || 0 })
      this._persistSession()
    }

    var scores = []
    if (Object.prototype.toString.call(session.scores) === '[object Array]') {
      for (var i = 0; i < session.scores.length; i++) {
        if (this._fileExists(session.scores[i].path)) scores.push(session.scores[i])
      }
    }
    if (scores.length) this.setData({ scoreFiles: scores })
  },

  _safeFileName: function (name, fallback) {
    var s = String(name || '')
      .replace(/[\/\\:*?"<>|\r\n\t]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
    return s || (fallback || 'file')
  },

  _archiveRecording: function (tempPath, duration) {
    if (!tempPath) return

    var fs = wx.getFileSystemManager()
    var dir = wx.env.USER_DATA_PATH + '/recordings'
    try { fs.mkdirSync(dir, true) } catch (e) {}

    var name = this._recordingFileName()
    var savedPath = dir + '/' + name

    try {
      fs.saveFileSync(tempPath, savedPath)
    } catch (e) {
      console.error('录音归档失败:', e)
      return
    }

    var list = this.data.recentRecordings.slice()
    list.unshift({
      path: savedPath,
      name: name,
      bgName: this._bgName(),
      duration: duration || 0,
      createdAt: Date.now(),
      timeLabel: this._getTimeLabel()
    })

    while (list.length > MAX_HISTORY) {
      var dropped = list.pop()
      if (dropped && dropped.path) {
        try { fs.unlinkSync(dropped.path) } catch (e) {}
      }
    }

    var patch = { recentRecordings: list }
    // 让刚录完的这条在列表里高亮为「当前」
    if (this.data.recordingFilePath === tempPath) patch.recordingFilePath = savedPath

    this.setData(patch)
    this._persistRecordings()
  },

  _bgName: function () {
    if (!this.data.bgMusicFileName) return ''
    var bg = this._safeFileName(this.data.bgMusicFileName, '').replace(/\.[^.]+$/, '')
    if (bg.length > 24) bg = bg.slice(0, 24)
    return bg
  },

  _recordingFileName: function () {
    var bg = this._bgName()
    return (bg ? bg + '_' : '') + '录音_' + this._getTimestamp() + '.mp3'
  },

  _getTimeLabel: function () {
    var d = new Date()
    var pad = function (n) { return (n < 10 ? '0' : '') + n }
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  },

  openSkipModal: function () {
    if (this.data.recordingState === 'recording') return
    this.setData({ skipModalVisible: true })
  },

  closeSkipModal: function () {
    this.setData({ skipModalVisible: false })
  },

  noop: function () {},

  onSkipStartChanging: function (e) {
    var val = Number(e.detail.value)
    if (!isFinite(val) || val < 0) val = 0
    this.setData({ bgSkipStart: Math.round(val * 2) / 2 })
  },

  onSkipStartChange: function (e) {
    if (this.data.recordingState === 'recording') return

    var val = Number(e.detail.value)
    if (!isFinite(val) || val < 0) val = 0
    this._commitSkip(Math.round(val * 2) / 2)
  },

  onSkipPresetTap: function (e) {
    if (this.data.recordingState === 'recording') return

    var val = Number(e.currentTarget.dataset.value)
    if (!isFinite(val) || val < 0) val = 0
    this._commitSkip(Math.min(val, this.data.bgSkipMax))
  },

  _commitSkip: function (val) {
    this.setData({ bgSkipStart: val })

    if (this.bgAudioCtx && this.data.bgDuration > 0) {
      try { this.bgAudioCtx.seek(val) } catch (err) {}
    }
    this._applyBgProgress(val)
    this._persistSession()
  },

  _updateSkipMax: function () {
    var d = this.data.bgDuration
    var max = 60
    if (isFinite(d) && d > 1) {
      max = Math.floor(d) - 1
    }
    if (max < 5) max = 5

    this.setData({
      bgSkipMax: max,
      bgSkipStart: Math.min(this.data.bgSkipStart, max)
    })
  },

  // 进度按完整时长计算：跳过多少，进度条起点就前进多少
  _applyBgProgress: function (t) {
    var total = this.data.bgDuration

    this.setData({
      bgCurrentTime: t,
      bgProgressPercent: (isFinite(total) && total > 0) ? Math.min(100, (t / total) * 100) : 0
    })
  },

  onBgVolumeChange: function (e) {
    if (this.data.recordingState === 'recording') return

    var val = e.detail.value
    this.setData({ bgVolume: val })
    if (this.bgAudioCtx) {
      this.bgAudioCtx.volume = val / 100
    }
    this._persistSession()
  },

  chooseScoreFile: function () {
    var self = this
    wx.showActionSheet({
      itemList: ['从手机相册选择', '从微信聊天选择'],
      success: function (res) {
        if (res.tapIndex === 0) {
          self._chooseScoreFromAlbum()
        } else if (res.tapIndex === 1) {
          self._chooseScoreFromChat()
        }
      },
      fail: function () {}
    })
  },

  _chooseScoreFromAlbum: function () {
    var self = this
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      sourceType: ['album'],
      sizeType: ['original'],
      success: function (res) {
        self._clearDir('scores')
        var files = (res.tempFiles || []).map(function (file, index) {
          var name = '相册歌谱' + (index + 1)
          return {
            path: self._keepFile(file.tempFilePath, 'scores', self._scoreSavedName(index, name, file.tempFilePath)),
            name: name
          }
        })

        if (files.length) {
          self.setData({ scoreFiles: files, removedScores: [] })
          self._persistSession()
        }
      }
    })
  },

  _chooseScoreFromChat: function () {
    var self = this
    wx.chooseMessageFile({
      count: 9,
      type: 'image',
      success: function (res) {
        self._clearDir('scores')
        var files = (res.tempFiles || []).map(function (file, index) {
          var name = file.name || ('歌谱' + (index + 1))
          return {
            path: self._keepFile(file.path, 'scores', self._scoreSavedName(index, name, file.path)),
            name: name
          }
        })

        if (files.length) {
          self.setData({ scoreFiles: files, removedScores: [] })
          self._persistSession()
        }
      }
    })
  },

  removeScoreFile: function () {
    this.setData({
      removedScores: this.data.scoreFiles,
      scoreFiles: []
    })
    this._persistSession()
  },

  restoreScoreFile: function () {
    if (this.data.recordingState === 'recording') return
    if (!this.data.removedScores.length) return

    this.setData({
      scoreFiles: this.data.removedScores,
      removedScores: []
    })
    this._persistSession()
  },

  initPlaybackAudio: function (filePath) {
    var self = this

    if (self.playAudioCtx) {
      self.stopPlaybackProgressLoop()
      try { self.playAudioCtx.destroy() } catch (e) {}
    }

    var audio = wx.createInnerAudioContext()
    audio.src = filePath
    self.playAudioCtx = audio

    audio.onCanplay(function () {
      var dur = audio.duration
      if (isFinite(dur) && dur > 0) {
        self.setData({ duration: dur })
      }
    })

    audio.onTimeUpdate(function () {
      self.syncPlaybackProgress()
    })

    audio.onEnded(function () {
      self.stopPlaybackProgressLoop()
      self.setData({
        isPlaying: false,
        currentTime: 0
      })
    })

    audio.onError(function (err) {
      console.error('回放错误:', err)
      self.stopPlaybackProgressLoop()
      self.setData({ isPlaying: false })
    })
  },

  togglePlayback: function () {
    if (!this.playAudioCtx) return

    if (this.data.isPlaying) {
      this.playAudioCtx.pause()
      this.stopPlaybackProgressLoop()
      this.setData({ isPlaying: false })
    } else {
      this.playAudioCtx.play()
      this.setData({ isPlaying: true })
      this.startPlaybackProgressLoop()
    }
  },

  onSeek: function (e) {
    if (!this.playAudioCtx) return

    var time = e.detail.value
    this.isSeeking = true
    this.playAudioCtx.seek(time)
    this.setData({ currentTime: time })

    var self = this
    setTimeout(function () {
      self.isSeeking = false
      self.syncPlaybackProgress()
    }, 300)
  },

  startPlaybackProgressLoop: function () {
    this.stopPlaybackProgressLoop()
    this.queuePlaybackProgressTick()
  },

  stopPlaybackProgressLoop: function () {
    if (this.playbackRafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.playbackRafId)
    }
    if (this.playbackTimer !== null) {
      clearTimeout(this.playbackTimer)
    }
    this.playbackRafId = null
    this.playbackTimer = null
  },

  queuePlaybackProgressTick: function () {
    var self = this
    if (typeof requestAnimationFrame === 'function') {
      this.playbackRafId = requestAnimationFrame(function () {
        self.playbackRafId = null
        self.runPlaybackProgressTick()
      })
      return
    }

    this.playbackTimer = setTimeout(function () {
      self.playbackTimer = null
      self.runPlaybackProgressTick()
    }, 16)
  },

  runPlaybackProgressTick: function () {
    if (!this.data.isPlaying || !this.playAudioCtx) return
    this.syncPlaybackProgress()
    if (this.data.isPlaying && this.playAudioCtx) {
      this.queuePlaybackProgressTick()
    }
  },

  syncPlaybackProgress: function () {
    if (!this.playAudioCtx || this.isSeeking) return

    var t = this.playAudioCtx.currentTime
    if (!isFinite(t) || t < 0) return

    if (Math.abs(t - this.data.currentTime) >= 0.015) {
      this.setData({ currentTime: t })
    }
  },

  saveRecording: function () {
    if (!this.data.recordingFilePath) {
      wx.showToast({ title: '没有录音文件', icon: 'none' })
      return
    }
    this._saveFile(this.data.recordingFilePath)
  },

  openShareModal: function () {
    if (!this.data.recordingFilePath) {
      wx.showToast({ title: '没有录音文件', icon: 'none' })
      return
    }

    this.setData({
      shareFilePath: this.data.recordingFilePath,
      sharePrefix: this._bgName(),
      shareFileName: this._lastShareSuffix(),
      shareModalVisible: true
    })
  },

  shareRecordingItem: function (e) {
    var item = this.data.recentRecordings[Number(e.currentTarget.dataset.index)]
    if (!item) return

    this.setData({
      shareFilePath: item.path,
      sharePrefix: item.bgName || this._bgName(),
      shareFileName: this._lastShareSuffix(),
      recentModalVisible: false,
      shareModalVisible: true
    })
  },

  closeShareModal: function () {
    this.setData({ shareModalVisible: false })
  },

  onShareNameInput: function (e) {
    this.setData({ shareFileName: e.detail.value })
  },

  resetShareName: function () {
    this.setData({ shareFileName: this._lastShareSuffix() })
  },

  // 输入框里只放「伴奏名之后」的部分，直接带出上次编辑的内容
  _lastShareSuffix: function () {
    try { return wx.getStorageSync(SHARE_SUFFIX_KEY) || '' } catch (e) {}
    return ''
  },

  confirmShare: function () {
    var self = this
    var prefix = this.data.sharePrefix || ''
    var suffix = String(this.data.shareFileName || '')
      .replace(/[\/\\:*?"<>|\r\n\t]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()

    var name
    if (prefix) {
      if (suffix.length > 40) suffix = suffix.slice(0, 40)
      name = suffix ? prefix + '_' + suffix : prefix
    } else {
      if (!suffix) suffix = '录音_' + this._getTimestamp()
      if (suffix.length > 60) suffix = suffix.slice(0, 60)
      name = suffix
    }

    // 记住用户这次编辑的内容，下次弹窗自动带出
    if (suffix) {
      try { wx.setStorageSync(SHARE_SUFFIX_KEY, suffix) } catch (e) {}
    }

    name = name + '.mp3'

    var sharePath = this.data.shareFilePath || this.data.recordingFilePath
    if (!sharePath) {
      wx.showToast({ title: '没有录音文件', icon: 'none' })
      return
    }

    // 让「保存」也用同一个名字
    var list = this.data.recentRecordings.slice()
    for (var i = 0; i < list.length; i++) {
      if (list[i].path === sharePath) {
        list[i].name = name
        break
      }
    }

    this.setData({ shareModalVisible: false, recentRecordings: list })
    this._persistRecordings()

    if (wx.shareFileMessage) {
      wx.shareFileMessage({
        filePath: sharePath,
        fileName: name,
        success: function () {},
        fail: function () {
          self._saveFile(sharePath)
        }
      })
    } else {
      self._saveFile(sharePath)
    }
  },

  _saveFile: function (filePath) {
    var fs = wx.getFileSystemManager()
    var fileName = this._recordingFileName()
    var list = this.data.recentRecordings || []
    for (var i = 0; i < list.length; i++) {
      if (list[i].path === filePath) {
        fileName = list[i].name
        break
      }
    }
    var savedPath = wx.env.USER_DATA_PATH + '/' + fileName

    try {
      fs.saveFileSync(filePath, savedPath)
    } catch (e) {
      savedPath = filePath
    }

    wx.saveFileToDisk({
      filePath: savedPath,
      success: function () {
        wx.showToast({ title: '已保存', icon: 'success' })
      },
      fail: function () {
        wx.openDocument({
          filePath: savedPath,
          showMenu: true,
          success: function () {
            wx.showToast({ title: '请通过右上角菜单保存', icon: 'none' })
          },
          fail: function () {
            wx.showToast({ title: '保存失败', icon: 'none' })
          }
        })
      }
    })
  },

  startDurationTimer: function () {
    var self = this
    self.stopDurationTimer()
    self.timer = setInterval(function () {
      self.setData({ duration: self.data.duration + 1 })
    }, 1000)
  },

  stopDurationTimer: function () {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },

  _getTimestamp: function () {
    var d = new Date()
    return d.getFullYear()
      + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1)
      + (d.getDate() < 10 ? '0' : '') + d.getDate()
      + '_' + (d.getHours() < 10 ? '0' : '') + d.getHours()
      + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes()
      + (d.getSeconds() < 10 ? '0' : '') + d.getSeconds()
  }
})
