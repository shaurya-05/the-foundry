'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownProps {
  content: string
  streaming?: boolean
  className?: string
}

export default function Markdown({ content, streaming = false, className }: MarkdownProps) {
  return (
    <div className={`forge-md ${className || ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
      {streaming && <span className="typing-cursor" />}
    </div>
  )
}
