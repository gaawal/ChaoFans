"""Streamable HTTP MCP transport using the existing, scoped Codex OAuth entry.
Credentials stay in the OS keychain and are never logged or written to this project.
Usage: python3 scripts/hyper3d_mcp.py tool_name arguments.json
"""
import json,subprocess,urllib.request,sys,os
ENDPOINT='https://api.hyper3d.com/api/mcp'
def call(name,args):
    raw=subprocess.check_output(['security','find-generic-password','-s','Codex MCP Credentials','-a','hyper3d|ea7d3976295c447f','-w'],stderr=subprocess.DEVNULL,text=True)
    cred=json.loads(raw)
    if cred.get('url')!=ENDPOINT:raise RuntimeError('Unexpected credential audience')
    token=cred['token_response']['access_token']
    payload={'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':name,'arguments':args}}
    req=urllib.request.Request(ENDPOINT,data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream','Authorization':'Bearer '+token})
    with urllib.request.urlopen(req,timeout=65) as r:body=r.read().decode()
    for line in body.splitlines():
        if line.startswith('data: '):return json.loads(line[6:])
    return json.loads(body)
def structured(result):
    result=result.get('result',result)
    if result.get('isError'):raise RuntimeError(str(result.get('content')))
    if 'structuredContent' in result:return result['structuredContent']
    for c in result.get('content',[]):
        if c.get('type')=='text':
            try:return json.loads(c['text'])
            except ValueError:pass
    return result
if __name__=='__main__':
    args=json.load(open(sys.argv[2])) if len(sys.argv)>2 else {}
    result=call(sys.argv[1],args)
    print(json.dumps(result,ensure_ascii=False,indent=2))
