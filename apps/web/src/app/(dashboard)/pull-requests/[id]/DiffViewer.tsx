'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, MessageSquare, Send, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

// ── Types ──────────────────────────────────────────────────────────────────────

interface DiffFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  language?: string;
}

interface LineComment {
  id: number;
  path: string;
  line: number | null;
  side: string;
  body: string;
  authorLogin: string;
  authorAvatar: string | null;
  createdAt: string;
  htmlUrl: string;
}

interface ParsedLine {
  type: 'hunk' | 'add' | 'del' | 'context';
  content: string;
  oldLine: number | null;
  newLine: number | null;
}

interface ActiveForm {
  filename: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
}

interface DiffViewerProps {
  files: DiffFile[];
  lineComments: LineComment[];
  onAddLineComment: (filePath: string, line: number, side: 'LEFT' | 'RIGHT', body: string) => Promise<void>;
}

// ── Patch parser ───────────────────────────────────────────────────────────────

function parsePatch(patch: string): ParsedLine[] {
  if (!patch) return [];
  const result: ParsedLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const raw of patch.split('\n')) {
    if (!raw) continue;

    if (raw.startsWith('@@')) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) { oldLine = parseInt(m[1], 10); newLine = parseInt(m[2], 10); }
      result.push({ type: 'hunk', content: raw, oldLine: null, newLine: null });
    } else if (raw.startsWith('+')) {
      result.push({ type: 'add', content: raw.slice(1), oldLine: null, newLine: newLine });
      newLine++;
    } else if (raw.startsWith('-')) {
      result.push({ type: 'del', content: raw.slice(1), oldLine: oldLine, newLine: null });
      oldLine++;
    } else {
      result.push({ type: 'context', content: raw.startsWith(' ') ? raw.slice(1) : raw, oldLine: oldLine, newLine: newLine });
      oldLine++;
      newLine++;
    }
  }

  return result;
}

function lineKey(filename: string, side: 'LEFT' | 'RIGHT', line: number) {
  return `${filename}:${side}:${line}`;
}

// ── File status badge ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    added: 'bg-green-100 text-green-700',
    modified: 'bg-blue-100 text-blue-700',
    removed: 'bg-red-100 text-red-700',
    renamed: 'bg-yellow-100 text-yellow-700',
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${map[status] ?? 'bg-gray-100 text-gray-700'}`}>
      {status}
    </span>
  );
}

// ── Single file diff ───────────────────────────────────────────────────────────

function FileDiff({
  file,
  lineComments,
  onAddLineComment,
}: {
  file: DiffFile;
  lineComments: LineComment[];
  onAddLineComment: DiffViewerProps['onAddLineComment'];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeForm, setActiveForm] = useState<ActiveForm | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const lines = parsePatch(file.patch ?? '');

  // Group comments by line key for quick lookup
  const commentsByKey: Record<string, LineComment[]> = {};
  for (const c of lineComments) {
    if (c.path !== file.filename || c.line == null) continue;
    const side = (c.side?.toUpperCase() ?? 'RIGHT') as 'LEFT' | 'RIGHT';
    const k = lineKey(file.filename, side, c.line);
    (commentsByKey[k] ??= []).push(c);
  }

  const openForm = (line: ParsedLine) => {
    const side: 'LEFT' | 'RIGHT' = line.type === 'del' ? 'LEFT' : 'RIGHT';
    const num = line.type === 'del' ? line.oldLine! : line.newLine!;
    setActiveForm({ filename: file.filename, line: num, side });
    setCommentBody('');
  };

  const closeForm = () => { setActiveForm(null); setCommentBody(''); };

  const submitComment = async () => {
    if (!activeForm || !commentBody.trim()) return;
    setSubmitting(true);
    try {
      await onAddLineComment(activeForm.filename, activeForm.line, activeForm.side, commentBody.trim());
      closeForm();
    } finally {
      setSubmitting(false);
    }
  };

  const isFormLine = (line: ParsedLine) => {
    if (!activeForm) return false;
    const side: 'LEFT' | 'RIGHT' = line.type === 'del' ? 'LEFT' : 'RIGHT';
    const num = line.type === 'del' ? line.oldLine : line.newLine;
    return activeForm.side === side && activeForm.line === num && activeForm.filename === file.filename;
  };

  return (
    <div className="rounded-lg border bg-card overflow-hidden text-xs font-mono">
      {/* File header */}
      <button
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-muted/40 hover:bg-muted/60 transition-colors text-left border-b"
        onClick={() => setCollapsed((v) => !v)}
      >
        {collapsed
          ? <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          : <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />}
        <span className="font-medium text-sm flex-1 truncate">{file.filename}</span>
        <StatusBadge status={file.status} />
        <span className="text-green-600 font-medium">+{file.additions}</span>
        <span className="text-red-500 font-medium">-{file.deletions}</span>
      </button>

      {!collapsed && (
        <div className="overflow-x-auto">
          {lines.length === 0 ? (
            <div className="px-4 py-3 text-muted-foreground text-xs italic">No diff available</div>
          ) : (
            <table className="w-full border-collapse">
              <tbody>
                {lines.map((line, idx) => {
                  if (line.type === 'hunk') {
                    return (
                      <tr key={idx} className="bg-blue-50/60 dark:bg-blue-950/20">
                        <td colSpan={4} className="px-4 py-1 text-blue-600 dark:text-blue-400 select-none text-[11px]">
                          {line.content}
                        </td>
                      </tr>
                    );
                  }

                  const side: 'LEFT' | 'RIGHT' = line.type === 'del' ? 'LEFT' : 'RIGHT';
                  const lineNum = line.type === 'del' ? line.oldLine! : line.newLine!;
                  const key = lineKey(file.filename, side, lineNum);
                  const commentsOnLine = commentsByKey[key] ?? [];
                  const isHovered = hoveredKey === key;
                  const showForm = isFormLine(line);

                  const rowBg =
                    line.type === 'add' ? 'bg-green-50 dark:bg-green-950/20' :
                    line.type === 'del' ? 'bg-red-50 dark:bg-red-950/20' :
                    'bg-background';

                  const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
                  const prefixColor =
                    line.type === 'add' ? 'text-green-600' :
                    line.type === 'del' ? 'text-red-500' :
                    'text-muted-foreground';

                  return (
                    <>
                      <tr
                        key={idx}
                        className={`group ${rowBg} hover:brightness-95 dark:hover:brightness-110`}
                        onMouseEnter={() => setHoveredKey(key)}
                        onMouseLeave={() => setHoveredKey(null)}
                      >
                        {/* Old line number */}
                        <td className="w-10 px-2 py-0.5 text-right text-muted-foreground/60 select-none border-r border-border/40">
                          {line.oldLine ?? ''}
                        </td>
                        {/* New line number */}
                        <td className="w-10 px-2 py-0.5 text-right text-muted-foreground/60 select-none border-r border-border/40">
                          {line.newLine ?? ''}
                        </td>
                        {/* +/- prefix */}
                        <td className={`w-4 px-1 py-0.5 text-center select-none ${prefixColor}`}>
                          {prefix}
                        </td>
                        {/* Code content */}
                        <td className="px-2 py-0.5 whitespace-pre">
                          {line.content}
                        </td>
                        {/* Add comment button */}
                        <td className="w-8 pr-1 py-0.5">
                          <button
                            onClick={() => openForm(line)}
                            className={`h-5 w-5 rounded flex items-center justify-center text-primary bg-primary/10 hover:bg-primary/20 transition-opacity ${isHovered || showForm ? 'opacity-100' : 'opacity-0'}`}
                            title="Add comment on this line"
                          >
                            <MessageSquare className="h-3 w-3" />
                          </button>
                        </td>
                      </tr>

                      {/* Inline comment form */}
                      {showForm && (
                        <tr key={`form-${idx}`} className="bg-yellow-50/50 dark:bg-yellow-950/10">
                          <td colSpan={5} className="px-4 py-3">
                            <div className="rounded-lg border border-yellow-300 dark:border-yellow-700 bg-white dark:bg-card overflow-hidden">
                              <div className="px-3 py-1.5 bg-yellow-100 dark:bg-yellow-900/30 border-b border-yellow-200 dark:border-yellow-700 flex items-center justify-between">
                                <span className="text-[11px] font-medium text-yellow-800 dark:text-yellow-300">
                                  Comment on line {lineNum} ({activeForm!.side === 'LEFT' ? 'original' : 'new'})
                                </span>
                                <button onClick={closeForm} className="text-muted-foreground hover:text-foreground">
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              <textarea
                                autoFocus
                                value={commentBody}
                                onChange={(e) => setCommentBody(e.target.value)}
                                placeholder="Leave a comment on this line…"
                                rows={3}
                                className="w-full px-3 py-2 text-xs font-sans bg-transparent resize-none outline-none"
                              />
                              <div className="flex justify-end gap-2 px-3 py-2 border-t border-border/40">
                                <button
                                  onClick={closeForm}
                                  className="rounded px-3 py-1 text-xs text-muted-foreground hover:bg-secondary transition-colors"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={submitComment}
                                  disabled={submitting || !commentBody.trim()}
                                  className="rounded bg-primary text-primary-foreground px-3 py-1 text-xs font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1 transition-colors"
                                >
                                  <Send className="h-3 w-3" />
                                  {submitting ? 'Posting…' : 'Add comment'}
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}

                      {/* Existing comments on this line */}
                      {commentsOnLine.length > 0 && (
                        <tr key={`comments-${idx}`}>
                          <td colSpan={5} className="px-4 py-2 bg-muted/20">
                            <div className="space-y-2 pl-8">
                              {commentsOnLine.map((c) => (
                                <div key={c.id} className="rounded-lg border bg-card overflow-hidden font-sans">
                                  <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/30">
                                    {c.authorAvatar && (
                                      <img src={c.authorAvatar} alt={c.authorLogin} className="h-4 w-4 rounded-full" />
                                    )}
                                    <span className="text-xs font-medium">{c.authorLogin}</span>
                                    <span className="text-[10px] text-muted-foreground ml-auto">
                                      {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                                    </span>
                                    <a
                                      href={c.htmlUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-[10px] text-muted-foreground hover:text-primary"
                                    >
                                      ↗
                                    </a>
                                  </div>
                                  <p className="px-3 py-2 text-xs whitespace-pre-wrap">{c.body}</p>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main DiffViewer ────────────────────────────────────────────────────────────

export function DiffViewer({ files, lineComments, onAddLineComment }: DiffViewerProps) {
  if (files.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No changed files in this pull request.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {files.map((file) => (
        <FileDiff
          key={file.filename}
          file={file}
          lineComments={lineComments.filter((c) => c.path === file.filename)}
          onAddLineComment={onAddLineComment}
        />
      ))}
    </div>
  );
}
