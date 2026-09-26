/**
 * 编译后端验收脚本：8 个典型数据结构程序全部编译运行输出正确才算通过。
 * 用法：node scripts/acceptance.mjs
 */
const ENDPOINT = 'https://wandbox.org/api/compile.json';

const CASES = [
  {
    name: '单链表反转',
    stdin: '',
    expect: '1 2 3 4 5 \n',
    code: `#include <iostream>
using namespace std;
struct Node { int val; Node* next; };
Node* reverse(Node* head) {
    Node* prev = nullptr;
    while (head) { Node* nxt = head->next; head->next = prev; prev = head; head = nxt; }
    return prev;
}
int main() {
    Node* head = nullptr;
    for (int i = 1; i <= 5; i++) { Node* n = new Node{i, head}; head = n; }
    head = reverse(head);
    for (Node* p = head; p; p = p->next) cout << p->val << ' ';
    cout << endl;
    return 0;
}
`,
  },
  {
    name: '二叉树前中后序遍历',
    stdin: '',
    expect: '1 2 4 5 3 6 \n4 2 5 1 3 6 \n4 5 2 6 3 1 \n',
    code: `#include <iostream>
using namespace std;
struct T { int v; T *l = nullptr, *r = nullptr; };
void pre(T* t){ if(!t)return; cout<<t->v<<' '; pre(t->l); pre(t->r); }
void mid(T* t){ if(!t)return; mid(t->l); cout<<t->v<<' '; mid(t->r); }
void post(T* t){ if(!t)return; post(t->l); post(t->r); cout<<t->v<<' '; }
int main(){ T n[6]; int v[6]={1,2,3,4,5,6}; for(int i=0;i<6;i++)n[i].v=v[i];
 n[0].l=&n[1]; n[0].r=&n[2]; n[1].l=&n[3]; n[1].r=&n[4]; n[2].r=&n[5];
 pre(&n[0]); cout<<"\\n"; mid(&n[0]); cout<<"\\n"; post(&n[0]); cout<<"\\n"; }
`,
  },
  {
    name: '快速排序（stdin 输入）',
    stdin: '5\n3 1 4 1 5\n',
    expect: '1 1 3 4 5\n',
    code: `#include <iostream>
using namespace std;
void qs(int a[], int lo, int hi){
  if(lo>=hi) return;
  int p=a[(lo+hi)/2], i=lo, j=hi;
  while(i<=j){ while(a[i]<p)i++; while(a[j]>p)j--; if(i<=j){swap(a[i],a[j]);i++;j--;} }
  qs(a,lo,j); qs(a,i,hi);
}
int main(){ int n; cin>>n; int a[100]; for(int i=0;i<n;i++)cin>>a[i]; qs(a,0,n-1);
  for(int i=0;i<n;i++)cout<<a[i]<<(i+1<n?' ':'\\n'); }
`,
  },
  {
    name: 'vector + sort',
    stdin: '',
    expect: '1,3,4,5,4 5\n',
    code: `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;
int main(){ vector<int> v{5,3,1}; v.push_back(4); sort(v.begin(), v.end());
 for(int x: v) cout << x << ',';
 cout << v.size() << ' ' << v.back() << endl; }
`,
  },
  {
    name: 'stack',
    stdin: '',
    expect: '3 2 1 empty:yes\n',
    code: `#include <iostream>
#include <stack>
using namespace std;
int main(){ stack<int> s;
 for(int i=1;i<=3;i++)s.push(i);
 while(!s.empty()){cout<<s.top()<<' ';s.pop();}
 cout<<"empty:"<<(s.empty()?"yes":"no")<<endl; }
`,
  },
  {
    name: 'queue',
    stdin: '',
    expect: 'a b c size:0\n',
    code: `#include <iostream>
#include <queue>
#include <string>
using namespace std;
int main(){ queue<string> q; q.push("a"); q.push("b"); q.push("c");
 while(!q.empty()){cout<<q.front()<<' ';q.pop();}
 cout<<"size:"<<q.size()<<endl; }
`,
  },
  {
    name: 'map',
    stdin: '',
    expect: 'apple=4;banana=2;0\n',
    code: `#include <iostream>
#include <map>
#include <string>
using namespace std;
int main(){ map<string,int> m; m["apple"]=3; m["banana"]=2; m["apple"]+=1;
 for(auto& p:m) cout<<p.first<<'='<<p.second<<';';
 cout<<m.count("pear")<<endl; }
`,
  },
  {
    name: '中文注释 + iostream + stdin',
    stdin: '21\n',
    expect: 'n*2=42\n',
    code: `// 中文注释：读入 n，输出 n 的两倍
#include <iostream>
using namespace std;
int main(){
    int n;
    cin >> n;            // 输入
    cout << "n*2=" << n*2 << endl;  // 输出
    return 0;
}
`,
  },
];

const norm = s => String(s ?? '').replace(/\r\n/g, '\n');

let pass = 0;
let fail = 0;
for (const c of CASES) {
  try {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ compiler: 'gcc-13.2.0', code: c.code, stdin: c.stdin, options: 'warning,gnu++17' }),
    });
    const data = await resp.json();
    const out = norm(data.program_output);
    const ok = String(data.status) === '0' && out === norm(c.expect);
    if (ok) {
      pass++;
      console.log(`PASS  ${c.name}`);
    } else {
      fail++;
      console.log(`FAIL  ${c.name}`);
      console.log(`  status=${data.status} expect=${JSON.stringify(norm(c.expect))} got=${JSON.stringify(out)}`);
      if (data.compiler_error) console.log(`  compiler_error: ${data.compiler_error.slice(0, 300)}`);
    }
  } catch (e) {
    fail++;
    console.log(`FAIL  ${c.name} (网络/异常: ${e.message})`);
  }
}
console.log(`\n${pass}/${CASES.length} passed`);
process.exit(fail ? 1 : 0);
