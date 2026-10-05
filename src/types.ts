// 需求管理 v0.1 共享类型（前后端同形，worker 侧不 import 前端文件，各自声明一次）。

export type ReqStatus = 'todo' | 'doing' | 'done'

export interface Project {
  id: string
  name: string
  createdAt: number
}

export interface ReqLink {
  id: string
  label: string
  url: string
  note: string
}

export interface Requirement {
  id: string
  projectId: string
  title: string
  body: string
  status: ReqStatus
  links: ReqLink[]
  createdAt: number
  updatedAt: number
}
