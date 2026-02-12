import * as vscode from 'vscode';
import { showDiagnostics } from '../../commands/diagnostics';
import { getAllInstances } from '../../utils/instanceHelpers';
import { getForgejoConfig } from '../../utils/config';

jest.mock('../../utils/instanceHelpers');
jest.mock('../../utils/config');

const mockGetAllInstances = getAllInstances as jest.MockedFunction<typeof getAllInstances>;
const mockGetForgejoConfig = getForgejoConfig as jest.MockedFunction<typeof getForgejoConfig>;

describe('showDiagnostics', () => {
	let mockConfigGet: jest.Mock;
	let mockOutputChannel: { append: jest.Mock; appendLine: jest.Mock; clear: jest.Mock; show: jest.Mock; dispose: jest.Mock };

	beforeEach(() => {
		jest.clearAllMocks();

		mockConfigGet = jest.fn().mockImplementation((key: string) => {
			const values: Record<string, any> = {
				instances: [{ id: 'inst-1', name: 'My Forgejo', instanceUrl: 'https://git.example.com', token: 'tok123' }],
				instanceUrl: 'https://git.example.com',
				token: 'secret-token',
				autoDetectFromRemote: true,
			};
			return values[key];
		});
		(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({ get: mockConfigGet });

		mockOutputChannel = {
			append: jest.fn(),
			appendLine: jest.fn(),
			clear: jest.fn(),
			show: jest.fn(),
			dispose: jest.fn(),
		};
		(vscode.window.createOutputChannel as jest.Mock).mockReturnValue(mockOutputChannel);

		mockGetAllInstances.mockResolvedValue([
			{
				id: 'inst-1',
				name: 'My Forgejo',
				instanceUrl: 'https://git.example.com',
				token: 'tok123',
				isDefault: true,
				lastConnectionTest: { success: true, timestamp: Date.now() },
			},
		]);

		mockGetForgejoConfig.mockResolvedValue({
			instanceUrl: 'https://git.example.com',
			owner: 'test-owner',
			repo: 'test-repo',
			token: 'tok123',
			instanceId: 'inst-1',
			matchConfidence: 'exact',
		});

		(vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);
	});

	// Flush microtasks after each test to prevent fire-and-forget .then() leaking
	afterEach(async () => {
		await new Promise(process.nextTick);
	});

	it('calls getConfiguration with "forgejo"', async () => {
		await showDiagnostics();
		expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('forgejo');
	});

	it('calls getAllInstances', async () => {
		await showDiagnostics();
		expect(mockGetAllInstances).toHaveBeenCalled();
	});

	it('calls getForgejoConfig', async () => {
		await showDiagnostics();
		expect(mockGetForgejoConfig).toHaveBeenCalled();
	});

	it('creates output channel named "Forgejo Diagnostics"', async () => {
		await showDiagnostics();
		expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('Forgejo Diagnostics');
	});

	it('writes report to output channel and shows it', async () => {
		await showDiagnostics();

		expect(mockOutputChannel.clear).toHaveBeenCalled();
		expect(mockOutputChannel.appendLine).toHaveBeenCalledTimes(1);

		const report = mockOutputChannel.appendLine.mock.calls[0][0] as string;
		expect(report).toContain('=== Forgejo Extension Diagnostics ===');
		expect(report).toContain('Validated Instances');
		expect(report).toContain('Active Configuration');
		expect(report).toContain('https://git.example.com');
		expect(mockOutputChannel.show).toHaveBeenCalled();
	});

	it('shows information message with instance count', async () => {
		await showDiagnostics();
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			'Diagnostics logged. Found 1 instance(s).',
			'View Output',
			'Copy to Clipboard'
		);
	});

	it('"View Output" action shows the output channel again', async () => {
		(vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('View Output');
		await showDiagnostics();

		// Allow the fire-and-forget .then callback to execute
		await new Promise(process.nextTick);

		// show() is called once during report display and once from the action
		expect(mockOutputChannel.show).toHaveBeenCalledTimes(2);
	});

	it('"Copy to Clipboard" action copies the report', async () => {
		(vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Copy to Clipboard');
		await showDiagnostics();

		await new Promise(process.nextTick);

		expect((vscode.env.clipboard.writeText as jest.Mock)).toHaveBeenCalledTimes(1);
		const copiedText = (vscode.env.clipboard.writeText as jest.Mock).mock.calls[0][0] as string;
		expect(copiedText).toContain('=== Forgejo Extension Diagnostics ===');

		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Diagnostics copied to clipboard');
	});

	it('shows zero instances when none are configured', async () => {
		mockGetAllInstances.mockResolvedValue([]);
		mockGetForgejoConfig.mockResolvedValue(null);

		await showDiagnostics();

		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			'Diagnostics logged. Found 0 instance(s).',
			'View Output',
			'Copy to Clipboard'
		);

		const report = mockOutputChannel.appendLine.mock.calls[0][0] as string;
		expect(report).toContain('Count: 0');
		expect(report).toContain('No active configuration');
	});
});
