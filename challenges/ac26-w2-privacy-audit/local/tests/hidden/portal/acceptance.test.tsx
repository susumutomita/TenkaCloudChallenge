import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppConfigProvider } from '../config-context';
import { I18nProvider } from '../i18n';
import { ContainerWorkbenchPanel } from './ContainerWorkbenchPanel';

const mocks = vi.hoisted(() => ({
  getWorkbenchConfig: vi.fn(), getWorkbenchStarter: vi.fn(), inspectWorkbench: vi.fn(),
  testWorkbench: vi.fn(), prepareWorkbench: vi.fn(), submitFlag: vi.fn(),
}));
vi.mock('../api/portal-client', async (importOriginal) => ({
  ...await importOriginal<any>(), ...mocks,
}));
const root = process.env.AC26_PROBLEM_ROOT!;
const metadata = JSON.parse(readFileSync(root + '/metadata.json', 'utf8'));
const source = readFileSync(root + '/local/tests/hidden/portal/reader-auditor.py', 'utf8');
const files = { 'auditor.py': source };
const base = process.env.AC26_WORKBENCH_URL ?? 'http://127.0.0.1:18098';
const flags = metadata.scoring.checks.map((c: any) => ({
  id: c.id, label: c.label, points: c.points, solved: false, input: c.input,
}));
async function post(path: string, body: unknown) {
  const response = await fetch(base + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  return response.json();
}
let verified: string[];
let totalScore: number;
beforeEach(async () => {
  window.localStorage.setItem('tenkacloud.portal.locale', 'en');
  verified = [];
  totalScore = 0;
  mocks.getWorkbenchConfig.mockResolvedValue(await (await fetch(base + '/api/config')).json());
  mocks.getWorkbenchStarter.mockResolvedValue(await (await fetch(base + '/api/starter')).json());
  mocks.inspectWorkbench.mockImplementation(async () => (await fetch(base + '/api/inspect')).json());
  mocks.testWorkbench.mockImplementation(async (_a, _s, _p, current) => post('/api/test', { files: current }));
  mocks.prepareWorkbench.mockImplementation(async (_a, _s, _p, current, manual) => post('/api/prepare', { files: current, manual }));
  mocks.submitFlag.mockImplementation(async (_a, _s, _p, submission, checkpointId) => {
    const verdict = await post('/verify', { checkpointId, submission });
    expect(verdict).toMatchObject({ checkpointId, correct: true });
    verified.push(checkpointId);
    const points = metadata.scoring.checks.find((c: any) => c.id === checkpointId).points;
    totalScore += points;
    return { kind: 'ok', scoreDelta: points, totalScore };
  });
});
afterEach(() => { vi.clearAllMocks(); window.localStorage.clear(); });

it('edits the real starter, runs public examples, submits all seven fields and collapses solved inputs', async () => {
  expect(createHash('sha256').update(source).digest('hex')).toBe('acf9a5e91d20572d10a2c8af4cc2eef4121ca6d50984d7bbd4ce5954b4a91806');
  expect(flags).toHaveLength(7);
  const user = userEvent.setup();
  render(<AppConfigProvider config={{ apiBaseUrl: base, eventTitle: 'Local acceptance', eventRegion: 'ap-northeast-1', mode: 'backend', cloudMode: 'real' }}>
    <I18nProvider><MemoryRouter><ContainerWorkbenchPanel apiBaseUrl={base} sessionToken="synthetic-local"
      problemId={metadata.id} flags={flags} onScored={async () => undefined} /></MemoryRouter></I18nProvider>
  </AppConfigProvider>);
  const editor = await screen.findByLabelText('auditor.py');
  expect(editor).not.toHaveValue(source);
  await user.clear(editor);
  await user.click(editor);
  await user.paste(source);
  expect(editor).toHaveValue(source);
  await user.click(screen.getByRole('button', { name: 'Inspect evidence' }));
  await screen.findByText(/specification \(this is what your auditor is given\)/);
  await user.click(screen.getByRole('button', { name: 'Run public tests' }));
  await screen.findByText('Public tests passed');
  const codeMessage = 'This checkpoint submits the current source from the editors above.';
  expect(screen.getAllByText(codeMessage)).toHaveLength(7);
  for (let i = 0; i < flags.length; i++) {
    const button = screen.getAllByRole('button', { name: /^Submit \(/ })[0];
    expect(button).not.toBeDisabled();
    await user.click(button);
    await waitFor(() => expect(verified).toEqual(flags.slice(0, i + 1).map((f: any) => f.id)), { timeout: 15000 });
    await waitFor(() => expect(screen.queryAllByText(codeMessage)).toHaveLength(flags.length - i - 1));
    expect(mocks.submitFlag.mock.calls[i][4]).toBe(flags[i].id);
  }
  expect(mocks.prepareWorkbench).toHaveBeenCalledTimes(7);
  for (const call of mocks.prepareWorkbench.mock.calls) expect(call[3]).toEqual(files);
  expect(totalScore).toBe(metadata.scoring.checks.reduce((sum: number, c: any) => sum + c.points, 0));
  expect(screen.queryByRole('button', { name: /^Submit \(/ })).not.toBeInTheDocument();
}, 60000);
