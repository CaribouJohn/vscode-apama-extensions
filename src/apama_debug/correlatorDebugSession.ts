import {
	DebugSession,
	InitializedEvent,
	StoppedEvent,
	Thread,
	StackFrame,
	Source,
	Scope,
	Variable,
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { CorrelatorHttpInterface, CorrelatorBreakpoint, CorrelatorPaused } from './correlatorHttpInterface';
import { basename } from 'path';
import * as vscode from 'vscode';
import { ApamaEnvironment } from '../apama_util/apamaenvironment';
import { ApamaRunner } from '../apama_util/apamarunner';

const MAX_STACK_SIZE = 1000;

interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	/** List of files to inject into the correlator */
	injectionList: string[];
}

/**
 * Handles debug requests from the frontend
 * Order of events received:
 * - Initialize
 * - Launch
 * (After Initialized sent back to client)
 * - SetBreakpoint (Zero or more)
 * - ConfigurationDone
 */

export interface CorrelatorConfig {
	host: string;
	port: number;
	args: string[];
}

export class CorrelatorDebugSession extends DebugSession {
	private deployCmd: ApamaRunner;
	private injectCmd: ApamaRunner;
	private correlatorHttp: CorrelatorHttpInterface;
	private manager: ApamaRunner;
	private correlatorBreakPoints: {[key:string]:string};
	public constructor(private logger: vscode.OutputChannel, private apamaEnv: ApamaEnvironment, private config: CorrelatorConfig) {
		super();

		this.manager = new ApamaRunner("engine_management", apamaEnv.getManagerCmdline(),logger);
		this.deployCmd = new ApamaRunner("engine_deploy", apamaEnv.getDeployCmdline(), logger);
		this.injectCmd = new ApamaRunner("engine_inject", apamaEnv.getInjectCmdline(), logger);
		console.log("Correlator interface host: " + config.host.toString() + " port " + config.port.toString());
		this.correlatorHttp = new CorrelatorHttpInterface(logger, config.host, config.port);
		this.correlatorBreakPoints = {} as {[key:string] : string };
	}

	/**
	 * The 'initialize' request is the first request called by the frontend
	 * to interrogate the features the debug adapter provides.
	 */
	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		console.log("Initialize called");

		if (!response.body) {
			response.body = {};
		}

		response.body.supportsConfigurationDoneRequest = true;
		response.body.supportsFunctionBreakpoints = false;
		response.body.exceptionBreakpointFilters = [
			{
				label: "Uncaught Exceptions",
				filter: 'uncaught',
				default: true
			}
		];

		this.sendResponse(response);
	}


	private runCorrelator(extraargs:string[]): vscode.Task {
		let localargs : string[] = this.config.args.concat(['-p',this.config.port.toString()]);
		/////console.log(extraargs);
		if( extraargs ) {
			localargs = localargs.concat(extraargs);
		}
		//console.log(localargs);
		let correlator = new vscode.Task(
		  {type: "shell", task: ""},
		  "DebugCorrelator",
		  "correlator",
		  new vscode.ShellExecution(this.apamaEnv.getCorrelatorCmdline(),localargs),
		  []
		);
		correlator.group = 'test';
		return correlator;
	  }
	/**
	 * Frontend requested that the application be launched
	 */
	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {

		let folder = undefined;
		//check for a single workspace 
		if( vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length === 1) {
			folder = vscode.workspace.workspaceFolders[0];
		}
		else
		{
			folder = await vscode.window.showWorkspaceFolderPick();
		}

		
		if (folder !== undefined) {

			/* Disable this for the moment 

			// does workspace contain folders
			// if yes - allow pick, check for deployed and then run
			let ws_contents = await vscode.workspace.fs.readDirectory(folder.uri);
			let deployed = ws_contents.filter( (curr) => {
				if ( curr[1] === vscode.FileType.Directory && curr[0].indexOf('_deployed') >= 0 ){
					return curr;
				}
			});
			//determine if we are able to run a project or just files
			let projectDebug = false;
			let csm = true;
			let csf = true;
			let csd = false;
			let ol = 'select monitor files';
			let fil = {
				'monitor files': ['mon']
			};

			if ( deployed.length > 0 ) {
				//We have deployed project(s) we can run - is that whats required?
				const result = await vscode.window.showQuickPick(['debug file(s)', 'debug deployed project'], {
					placeHolder: 'debug file(s) or project'
				});

				console.log("CHOICE");
				console.log(result);
				
				if(result && result.indexOf("project") >= 0) {
					projectDebug = true;
					csm = false;
					csf = false;
					csd = true;
					let ol = 'select deployed project';
					let fil = {
						'Deployed projects': ['*_deployed']
					};
				}
			}

			//pick deployed 
			const options: vscode.OpenDialogOptions = {
				defaultUri: folder.uri,
				canSelectMany: csm,
				canSelectFiles: csf,
				canSelectFolders: csd,
				openLabel: ol,
				filters: fil
			};
			
			

			let fileUri:vscode.Uri[]|undefined = await vscode.window.showOpenDialog(options);

			*/
			let projectDebug = false;

			if( projectDebug ) {
				//single file initially
				//console.log("Project Debug started on host: " + this.config.host.toString() + " port " + this.config.port.toString());
				//if (fileUri && fileUri[0]) {
				//	console.log("Debug : " + fileUri[0].fsPath );
				//	await vscode.tasks.executeTask(this.runCorrelator(['--config',fileUri[0].fsPath]));	
				//	await this.correlatorHttp.enableDebugging();
				//	this.sendEvent(new InitializedEvent()); // We're ready to start recieving breakpoints
				//	this.sendResponse(response);
				//}
			}
			else
			{
				//single file initially
				console.log("Debug started on host: " + this.config.host.toString() + " port " + this.config.port.toString());
				await vscode.tasks.executeTask(this.runCorrelator([]));	
				await this.correlatorHttp.enableDebugging();
				if (folder.uri.fsPath) {
					//console.log("Debug File(s) : " + folder.uri.fsPath );
					await this.deployCmd.run('.', ['--inject', this.config.host.toString(), this.config.port.toString()]
						.concat(folder.uri.fsPath));
					this.sendEvent(new InitializedEvent()); // We're ready to start recieving breakpoints
					this.sendResponse(response);
				}
			}

			// Pause correlator while we wait for the configuration to finish, we want breakpoints to be set first
			await this.correlatorHttp.pause();

			
			console.log('Enable change handler: ', vscode.debug.breakpoints.length);
			//now we can add a handler for changes in BP 
			vscode.debug.onDidChangeBreakpoints(async e => {
				console.log(`onDidChangeBreakpoints: a: ${e.added.length} r: ${e.removed.length} c: ${e.changed.length}`);
				
				if (e.added.length > 0) { 
					console.log('Enable breakpoints: ', e.added.length);
					for (let bp of e.added) {
						if(bp instanceof vscode.SourceBreakpoint){
							let bpLine = bp.location.range.start.line + 1;
							this.correlatorBreakPoints[bp.location.uri.fsPath +':'+ bpLine.toString()] = '-1';
							//console.log("REQUESTING " + bp.location.uri.fsPath +':'+ bpLine.toString() );
							let id:string = await this.correlatorHttp.setBreakpoint(bp.location.uri.fsPath, bpLine );
							this.correlatorBreakPoints[bp.location.uri.fsPath +':'+ bpLine.toString()] = id;
							//console.log("REQUESTED " + bp.location.uri.fsPath +':'+ bpLine.toString() + '==id==' + id );
						}
					}
				}

				if (e.removed.length > 0) { 
					for (let bp of e.removed) {
						if(bp instanceof vscode.SourceBreakpoint){
							let bpLine = bp.location.range.start.line + 1;
							//console.log("REMOVING " + bp.location.uri.fsPath +':'+ bpLine.toString() );
							await this.correlatorHttp.deleteBreakpoint(this.correlatorBreakPoints[bp.location.uri.fsPath +':'+ bpLine.toString()]);
							//console.log("REMOVED " + bp.location.uri.fsPath +':'+ bpLine.toString() + '==id==' + this.correlatorBreakPoints[bp.location.uri.fsPath +':'+ bpLine.toString()] );
							delete this.correlatorBreakPoints[bp.location.uri.fsPath +':'+ bpLine.toString()];
						}
					}
				}
				//if (e.changed.length) { console.log('changed: ', JSON.stringify(e.changed)); }
				
				//console.log('breakpoints after event: ', vscode.debug.breakpoints.length);

			});
	
		}

	}

	/**
	 * Frontend requested that breakpoints be set
	 * http://brickhousecodecamp.org/docs/vscode/code.visualstudio.com/docs/extensionAPI/api-debugging.html#_the-debug-adapter-protocol-in-a-nutshell
	 * 
	 * N.B. this request is repeated for each file with breakpoints 
	 * 
	 * we will clear and revalidate breakpoints for a file when this is called because otherwise we get into 
	 * having to persist and maintain the lists - the correlator already does this so no need for us to do it.
	 */
	protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): Promise<void> {
		if (args.source.path) 
		{
			const filePath = args.source.path;

			let bpsToCheck: Number[] = [];

			//Get the line numbers of the current request
			for ( let lineNumber  of args.lines || [] ){
				let currentKey: string = filePath +':'+ lineNumber.toString();
				console.log("Checking:" + currentKey );
				bpsToCheck.push(lineNumber);
			}

			// Pull out all curren tbreakpoints in the correlator
			let currentCorrelatorBreakpoints = await this.correlatorHttp.getAllSetBreakpoints();
			let currentCorrelatorBreakpointsById = currentCorrelatorBreakpoints.reduce(
				(acc, breakpoint) => 
				{
				acc[breakpoint.id] = breakpoint;
				return acc;
				} , {} as { [key: string]: CorrelatorBreakpoint });


			// Compare the attempted and the actually set to determine whether they've actually been set (and on which line)
			//I am verifying breakpoints that have actually been set in the correlator only - so I iterate through the real ones
			//just making sure we respond to the ones to check specifically (others will have existing state)
			let bps : DebugProtocol.Breakpoint[] = [];
			for ( let id in currentCorrelatorBreakpointsById) {
				let bp = currentCorrelatorBreakpointsById[id];
				//For this source file only!
				if ( bp.filename === filePath ) {

					if( bpsToCheck.includes(bp.line) ) {
						let index = bpsToCheck.findIndex((element) => element === bp.line);
						delete bpsToCheck[index];
						console.log('CONFIRMED:'+ bp.filename + '==id==' + 	this.correlatorBreakPoints[bp.filename +':'+ bp.line.toString()]);
						let src:DebugProtocol.Source = {name:bp.id,path:bp.filename};
						bps.push({id:+bp.id,verified:true,source:src});					
					} 
				}
			}

			response.body = {
				breakpoints: bps
			};

			// Send the response with the list of breakpoints
			this.sendResponse(response);
				
		} else {
			console.error("Unable to set breakpoints, no file path provided");
			this.sendResponse(response);
		}
	}

	/**
	 * Indication that the frontend is done setting breakpoints etc
	 */
	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		console.log('Configuration done');
		this.correlatorHttp.resume()
			.then(() => this.sendResponse(response))
			.then(() => this.waitForCorrelatorPause());
	}


	protected async waitUntilTaskEnds(taskName: string) {
		return new Promise<void>(resolve => {
			let disposable = vscode.tasks.onDidEndTask(e => {
				if (e.execution.task.name === taskName) {
					disposable.dispose();
					resolve();
				}
			});
		});
	}

	/**
	 * Frontend requested that the application terminate
	 */
	protected async disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments) {
		console.log("Stop requested to port " + this.config.port.toString());
		this.manager.run('.',['-s','debug_stop','-p',this.config.port.toString()]);
		await this.waitUntilTaskEnds("DebugCorrelator");
		//this.correlatorCmd.stop().then(() => this.sendResponse(response));
		this.sendResponse(response);
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		console.log("Threads requested");
		this.correlatorHttp.getContextStatuses()
			.then(contextStatuses => contextStatuses.map(status => new Thread(status.contextid, status.context)))
			.then(threads => {
				response.body = {
					threads
				};
				this.sendResponse(response);
			});
	}

	/**
	 * Frontend requested stacktrace
	 */
	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
		console.log("Stacktrace requested");
		this.correlatorHttp.getStackTrace(args.threadId)
			.then(correlatorStackFrames => correlatorStackFrames.stackframes.map((stackframe, i) => new StackFrame(this.createFrameId(correlatorStackFrames.contextid, i), stackframe.action, this.createSource(stackframe.filename), stackframe.lineno)))
			.then(stackFrames => {
				response.body = {
					stackFrames
				};
				this.sendResponse(response);
			});
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
		console.log("Scopes requested");
		response.body = {
			scopes: [
				new Scope("Local", this.createVariablesRef(args.frameId, 'local')),
				new Scope("Monitor", this.createVariablesRef(args.frameId, 'monitor'))
			]
		};
		this.sendResponse(response);
	}

	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
		console.log("Variables requested");
		const { contextid, frameidx, type } = this.parseVariablesRef(args.variablesReference);

		this.getVariablesForType(type, contextid, frameidx)
			.then(variables => variables
				.filter(variable => variable.value !== '<uninitialized>')
				.filter(variable => !variable.name.startsWith("::"))
				// Can end up with duplicate names for variables when used in other scopes (which is super annoying), so we number them.
				.map((variable, i, variables) => {
					const count = variables.slice(0, i + 1).filter(otherVariable => otherVariable.name === variable.name).length;
					if (count > 1) {
						variable.name = `${variable.name}#${count}`;
					}
					return variable;
				})
			)
			.then(variables => variables.map(variable => new Variable(variable.name, variable.value)))
			.then(variables => {
				response.body = {
					variables
				};
				this.sendResponse(response);
			});
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		console.log("Continue requested");
		this.correlatorHttp.resume()
			.then(() => this.sendResponse(response))
			.then(() => this.waitForCorrelatorPause());
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		console.log("Next requested");
		this.correlatorHttp.stepOver()
			.then(() => this.sendResponse(response))
			.then(() => this.waitForCorrelatorPause());
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
		console.log("Step In requested");
		this.correlatorHttp.stepIn()
			.then(() => this.sendResponse(response))
			.then(() => this.waitForCorrelatorPause());
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
		console.log("Step Out requested");
		this.correlatorHttp.stepOut()
			.then(() => this.sendResponse(response))
			.then(() => this.waitForCorrelatorPause());
	}

	protected setExceptionBreakPointsRequest(response: DebugProtocol.SetExceptionBreakpointsResponse, args: DebugProtocol.SetExceptionBreakpointsArguments): void {
		console.log("Exception breakpoint requested");
		const breakOnUncaught = args.filters.indexOf('uncaught') !== -1;
		this.correlatorHttp.setBreakOnErrors(breakOnUncaught)
			.then(() => this.sendResponse(response));
	}

	protected convertClientPathToDebugger(clientPath: string): string {
		return normalizeCorrelatorFilePath(super.convertClientPathToDebugger(clientPath));
	}

	protected convertDebuggerPathToClient(debuggerPath: string): string {
		return normalizeCorrelatorFilePath(super.convertDebuggerPathToClient(debuggerPath));
	}

	private async waitForCorrelatorPause() {
		let response = await this.correlatorHttp.awaitPause();
		this.sendEvent(new StoppedEvent(response.reason, response.contextid));
	}

	private createSource(filePath: string): Source {
		return new Source(basename(filePath), this.convertDebuggerPathToClient(filePath));
	}

	private createFrameId(contextId: number, frameidx: number): number {
		return contextId * MAX_STACK_SIZE + frameidx;
	}

	private parseFrameId(frameid: number): { contextid: number, frameidx: number } {
		const frameidx = frameid % MAX_STACK_SIZE;
		const contextid = (frameid - frameidx) / MAX_STACK_SIZE;
		return {
			contextid,
			frameidx
		};
	}

	private createVariablesRef(frameId: number, variableType: 'monitor' | 'local'): number {
		let typeNumber = 0;
		switch (variableType) {
			case 'local': typeNumber = 0; break;
			case 'monitor': typeNumber = 1; break;
		}
		return frameId * 10 + typeNumber;
	}

	private parseVariablesRef(variablesRef: number): { type: 'monitor' | 'local', contextid: number, frameidx: number } {
		const typeNumber = variablesRef % 10;
		let type: 'monitor' | 'local';
		switch (typeNumber) {
			case 0: type = 'local'; break;
			case 1: type = 'monitor'; break;
			default: throw Error("Unknown type code: " + typeNumber);
		}
		const { contextid, frameidx } = this.parseFrameId((variablesRef - typeNumber) / 10);
		return {
			type,
			contextid,
			frameidx
		};
	}

	private getVariablesForType(type: 'monitor' | 'local', contextid: number, frameidx: number) {
		switch (type) {
			case 'monitor': return this.correlatorHttp.getContextStatuses()
				.then(contextStatuses => contextStatuses.find(contextStatus => contextStatus.contextid === contextid))
				.then(possiblePause => {
					if (!possiblePause) {
						throw Error("Trying to read variables from non existent context: " + contextid);
					}
					if (!possiblePause.paused) {
						throw Error("Trying to read variables from unpaused context: " + contextid);
					}
					return possiblePause as CorrelatorPaused;
				})
				.then(pause => this.correlatorHttp.getMonitorVariables(contextid, pause.instance));
			case 'local': return this.correlatorHttp.getLocalVariables(contextid, frameidx);
		}
	}
}

export function normalizeCorrelatorFilePath(filePath: string): string {
	if (process.platform === 'win32') {
		return filePath.replace(/.+:/, match => match.toUpperCase());
	} else {
		return filePath;
	}
}
