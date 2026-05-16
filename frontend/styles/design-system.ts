/**
 * H3ROS Design Language v1.2 — design system constants.
 *
 * Section accents collapsed to a single Arc Cyan token per brand spec
 * (≤10% Arc Cyan, signature not substrate). Consumers (Sidebar, Header,
 * various Clients) that read sectionAccents[section] now all receive the
 * same Arc Cyan; per-section color distinction is dropped in favor of
 * the chassis/hairline visual system.
 */

// ─── Color tokens (mirror CSS vars in globals.css) ──────────────────────────
export const colors = {
  ink:           '#141413',
  offWhite:      '#F2F2EE',
  vellum:        '#E8E5DD',
  signal:        '#E84A0E',
  arcCyan:       '#9FDEFA',
  arcCyanDeep:   '#6BBFD9',
  n900:          '#141413',
  n600:          '#5F5F5A',
  n400:          '#9C9C95',
  n200:          '#D1D1CB',
  n100:          '#E8E5DD',
}

/**
 * Section accents — all routes resolve to Arc Cyan. Per-section color is
 * intentionally dropped per H3ROS brand spec; visual distinction now comes
 * from chassis grids, hairlines, and typography hierarchy.
 */
export const sectionAccents: Record<string, string> = {
  dashboard: colors.arcCyan,
  knowledge: colors.arcCyan,
  projects:  colors.arcCyan,
  tasks:     colors.arcCyan,
  context:   colors.arcCyan,
  insights:  colors.arcCyan,
  agents:    colors.arcCyan,
  copilot:   colors.arcCyan,
  workspace: colors.arcCyan,
  settings:  colors.arcCyan,
  ideas:     colors.arcCyan,
  launchpad: colors.arcCyan,
}

export const sectionLabels: Record<string, string> = {
  dashboard: 'Overview',
  knowledge: 'Research and docs',
  projects:  'Build tracker',
  tasks:     'Task board',
  context:   'AI analysis',
  insights:  'AI analysis',
  agents:    'AI analysis',
  workspace: 'Blueprint canvas',
  settings:  'Workspace settings',
  ideas:     'Ideas lab',
  launchpad: 'Launch brief',
}

/**
 * Agent colors — also collapsed to Arc Cyan. Individual agents are
 * distinguished by their drawn glyph + Archivo Black name + IBM Plex Serif
 * tagline, not by color.
 */
export const agentColors: Record<string, string> = {
  field_analyst:     colors.arcCyan,
  systems_architect: colors.arcCyan,
  market_scout:      colors.arcCyan,
  launch_strategist: colors.arcCyan,
}

export const agentNames: Record<string, string> = {
  field_analyst:     'Field Analyst',
  systems_architect: 'Systems Architect',
  market_scout:      'Market Scout',
  launch_strategist: 'Launch Strategist',
}
