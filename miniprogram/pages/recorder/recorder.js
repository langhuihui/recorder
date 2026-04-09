Page({
  data: {
    statusBarHeight: 20,
    recordingState: 'idle',
    duration: 0,
    currentTime: 0,
    isPlaying: false,
    bgMusicLoaded: false,
    bgMusicFileName: '',
    bgDuration: 0,
    bgCurrentTime: 0,
    bgVolume: 50,
    bgProgressPercent: 0,
    recordingFilePath: '',
    scoreFiles: []
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
        self.bgAudioCtx.seek(0)
        self.bgAudioCtx.play()
      }
    })

    this.recorderManager.onStop(function (res) {
      self.stopDurationTimer()

      if (self.bgAudioCtx) {
        self.bgAudioCtx.pause()
        self.bgAudioCtx.seek(0)
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
        isPlaying: false,
        bgCurrentTime: 0,
        bgProgressPercent: 0
      })

      self.initPlaybackAudio(res.tempFilePath)
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
      format: 'aac',
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

    if (this.data.recordingFilePath) {
      try {
        wx.getFileSystemManager().unlinkSync(this.data.recordingFilePath)
      } catch (e) {}
    }

    this.setData({
      recordingState: 'idle',
      duration: 0,
      currentTime: 0,
      isPlaying: false,
      recordingFilePath: ''
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
        self._loadBgMusic(file.path, file.name)
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
      }
    })

    bgAudio.onTimeUpdate(function () {
      var t = bgAudio.currentTime
      var d = bgAudio.duration
      if (!isFinite(t) || t < 0) return

      if (isFinite(d) && d > 0) {
        self.setData({
          bgCurrentTime: t,
          bgDuration: d,
          bgProgressPercent: (t / d) * 100
        })
      } else {
        self.setData({ bgCurrentTime: t })
      }
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
      bgDuration: 0,
      bgCurrentTime: 0,
      bgProgressPercent: 0
    })
  },

  removeBgMusic: function () {
    if (this.data.recordingState === 'recording') return

    if (this.bgAudioCtx) {
      try { this.bgAudioCtx.stop() } catch (e) {}
      try { this.bgAudioCtx.destroy() } catch (e) {}
      this.bgAudioCtx = null
    }

    this.setData({
      bgMusicLoaded: false,
      bgMusicFileName: '',
      bgDuration: 0,
      bgCurrentTime: 0,
      bgProgressPercent: 0
    })
  },

  onBgVolumeChange: function (e) {
    if (this.data.recordingState === 'recording') return

    var val = e.detail.value
    this.setData({ bgVolume: val })
    if (this.bgAudioCtx) {
      this.bgAudioCtx.volume = val / 100
    }
  },

  chooseScoreFile: function () {
    var self = this
    wx.chooseMessageFile({
      count: 9,
      type: 'image',
      success: function (res) {
        var files = (res.tempFiles || []).map(function (file, index) {
          return {
            path: file.path,
            name: file.name || ('歌谱' + (index + 1))
          }
        })

        self.setData({
          scoreFiles: files
        })
      }
    })
  },

  removeScoreFile: function () {
    this.setData({
      scoreFiles: []
    })
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
    var filePath = this.data.recordingFilePath
    if (!filePath) {
      wx.showToast({ title: '没有录音文件', icon: 'none' })
      return
    }

    var fs = wx.getFileSystemManager()
    var savedPath = wx.env.USER_DATA_PATH + '/录音_' + this._getTimestamp() + '.aac'

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

  shareRecording: function () {
    var filePath = this.data.recordingFilePath
    if (!filePath) {
      wx.showToast({ title: '没有录音文件', icon: 'none' })
      return
    }

    var self = this
    if (wx.shareFileMessage) {
      wx.shareFileMessage({
        filePath: filePath,
        fileName: '录音_' + self._getTimestamp() + '.aac',
        success: function () {},
        fail: function () {
          self.saveRecording()
        }
      })
    } else {
      self.saveRecording()
    }
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
