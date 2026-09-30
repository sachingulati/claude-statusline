'use strict';
// Claude Code's documented status line fields (its status line docs, as of 2.1.286). Line 1 can show any of them by name; /sline:config maps plain words onto
// this list, and a name not on it is accepted with a warning.
const DOCUMENTED = [
  'session_id', 'session_name', 'prompt_id', 'transcript_path', 'version', 'cwd',
  'model.id', 'model.display_name',
  'workspace.current_dir', 'workspace.project_dir', 'workspace.git_worktree',
  'workspace.repo.host', 'workspace.repo.owner', 'workspace.repo.name',
  'cost.total_cost_usd', 'cost.total_duration_ms', 'cost.total_api_duration_ms',
  'cost.total_lines_added', 'cost.total_lines_removed',
  'context_window.total_input_tokens', 'context_window.total_output_tokens', 'context_window.context_window_size',
  'context_window.used_percentage', 'context_window.remaining_percentage',
  'context_window.current_usage.input_tokens', 'context_window.current_usage.output_tokens',
  'context_window.current_usage.cache_creation_input_tokens', 'context_window.current_usage.cache_read_input_tokens',
  'exceeds_200k_tokens', 'fast_mode', 'effort.level', 'thinking.enabled',
  'rate_limits.five_hour.used_percentage', 'rate_limits.five_hour.resets_at',
  'rate_limits.seven_day.used_percentage', 'rate_limits.seven_day.resets_at',
  'rate_limits.spend_limit.used_percentage', 'rate_limits.spend_limit.resets_at',
  'rate_limits.spend_limit.used_usd', 'rate_limits.spend_limit.limit_usd', 'rate_limits.spend_limit.period',
  'prompt_cache.warm', 'prompt_cache.caching_observed', 'prompt_cache.ttl', 'prompt_cache.expires_at',
  'prompt_cache.requests', 'prompt_cache.misses', 'prompt_cache.expected_rebuilds', 'prompt_cache.hit_ratio',
  'prompt_cache.cache_write_tokens', 'prompt_cache.miss_recache_tokens', 'prompt_cache.last_miss_at',
  'prompt_cache.recache_tokens_if_cold',
  'output_style.name', 'vim.mode', 'agent.name',
  'pr.number', 'pr.url', 'pr.review_state', 'pr.kind',
  'worktree.name', 'worktree.path', 'worktree.branch', 'worktree.original_cwd', 'worktree.original_branch',
];
module.exports = { DOCUMENTED };
