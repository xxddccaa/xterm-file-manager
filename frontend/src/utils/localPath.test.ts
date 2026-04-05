import { describe, expect, it } from 'vitest'

import { getParentLocalPath, isLocalPathRoot } from './localPath'

describe('localPath', () => {
  it('gets parent for deep Windows paths without adding a leading slash', () => {
    expect(getParentLocalPath('D:\\xd_dev\\pipecat\\pipecat_apps\\livekit_video_chat_apk\\speech-turn'))
      .toBe('D:\\xd_dev\\pipecat\\pipecat_apps\\livekit_video_chat_apk')
  })

  it('returns drive root for single-level Windows paths', () => {
    expect(getParentLocalPath('D:\\workspace')).toBe('D:\\')
  })

  it('keeps Windows drive roots unchanged', () => {
    expect(getParentLocalPath('D:\\')).toBe('D:\\')
    expect(isLocalPathRoot('D:\\')).toBe(true)
  })

  it('handles POSIX parents correctly', () => {
    expect(getParentLocalPath('/Users/demo/project')).toBe('/Users/demo')
    expect(getParentLocalPath('/Users')).toBe('/')
    expect(isLocalPathRoot('/')).toBe(true)
  })

  it('handles UNC paths correctly', () => {
    expect(getParentLocalPath('\\\\server\\share\\folder')).toBe('\\\\server\\share')
    expect(isLocalPathRoot('\\\\server\\share')).toBe(true)
  })
})
