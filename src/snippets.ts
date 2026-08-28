export const SCAFFOLDS: Record<string, string> = {
  python: `import sys\n\n\ndef solve(data: str) -> str:\n    # TODO: parse input and compute the answer\n    return ""\n\n\ndef main() -> None:\n    data = sys.stdin.read()\n    sys.stdout.write(solve(data))\n\n\nif __name__ == "__main__":\n    main()\n`,
  cpp: `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    // TODO: read input and print the answer\n    return 0;\n}\n`,
  c: `#include <stdio.h>\n\nint main(void) {\n    /* TODO */\n    return 0;\n}\n`,
  java: `import java.util.*;\nimport java.io.*;\n\npublic class Main {\n    public static void main(String[] args) throws IOException {\n        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));\n        // TODO\n    }\n}\n`,
  go: `package main\n\nimport (\n\t"bufio"\n\t"fmt"\n\t"os"\n)\n\nfunc main() {\n\treader := bufio.NewReader(os.Stdin)\n\twriter := bufio.NewWriter(os.Stdout)\n\tdefer writer.Flush()\n\t_ = reader\n\t_ = fmt.Sprint\n\t// TODO\n}\n`,
  javascript: `const data = require("fs").readFileSync(0, "utf8");\n\nfunction solve(input) {\n  // TODO\n  return "";\n}\n\nprocess.stdout.write(solve(data));\n`,
  typescript: `import * as fs from "fs";\nconst data = fs.readFileSync(0, "utf8");\nfunction solve(input: string): string { return ""; }\nprocess.stdout.write(solve(data));\n`,
  php: `<?php\n$data = stream_get_contents(STDIN);\n// TODO\n`,
  ruby: `data = STDIN.read\n# TODO\n`,
  rust: `use std::io::{self, Read};\n\nfn main() {\n    let mut input = String::new();\n    io::stdin().read_to_string(&mut input).unwrap();\n    // TODO\n}\n`,
};

export function scaffold(lang: string, title?: string): string {
  const body = SCAFFOLDS[lang.toLowerCase()] ?? "// TODO: implement the solution\n";
  const comment = ["python", "ruby", "bash"].includes(lang.toLowerCase()) ? "#" : "//";
  return title ? `${comment} Solution for: ${title}\n\n${body}` : body;
}

export const CP_TEMPLATES: Record<string, { desc: string; python: string; cpp: string }> = {
  dsu: {
    desc: "Disjoint Set Union (union-find)",
    python: `class DSU:\n    def __init__(self, n): self.p = list(range(n)); self.r = [0]*n\n    def find(self, x):\n        while self.p[x] != x: self.p[x] = self.p[self.p[x]]; x = self.p[x]\n        return x\n    def union(self, a, b):\n        a, b = self.find(a), self.find(b)\n        if a == b: return False\n        if self.r[a] < self.r[b]: a, b = b, a\n        self.p[b] = a; self.r[a] += self.r[a] == self.r[b]\n        return True\n`,
    cpp: `struct DSU{ vector<int> p,r; DSU(int n):p(n),r(n,0){iota(p.begin(),p.end(),0);}\n  int find(int x){while(p[x]!=x){p[x]=p[p[x]];x=p[x];}return x;}\n  bool uni(int a,int b){a=find(a);b=find(b);if(a==b)return false;if(r[a]<r[b])swap(a,b);p[b]=a;if(r[a]==r[b])r[a]++;return true;}};\n`,
  },
  sieve: {
    desc: "Sieve of Eratosthenes",
    python: `def sieve(n):\n    p = bytearray([1])*(n+1); p[0:2] = b"\\x00\\x00"\n    for i in range(2, int(n**0.5)+1):\n        if p[i]: p[i*i::i] = bytearray(len(p[i*i::i]))\n    return [i for i in range(n+1) if p[i]]\n`,
    cpp: `vector<int> sieve(int n){vector<char> p(n+1,1);p[0]=p[1]=0;for(int i=2;(long long)i*i<=n;i++)if(p[i])for(int j=i*i;j<=n;j+=i)p[j]=0;vector<int> r;for(int i=2;i<=n;i++)if(p[i])r.push_back(i);return r;}\n`,
  },
  dijkstra: {
    desc: "Dijkstra shortest paths",
    python: `import heapq\ndef dijkstra(adj, src, n):\n    dist=[float('inf')]*n; dist[src]=0; pq=[(0,src)]\n    while pq:\n        d,u=heapq.heappop(pq)\n        if d>dist[u]: continue\n        for v,w in adj[u]:\n            if d+w<dist[v]: dist[v]=d+w; heapq.heappush(pq,(dist[v],v))\n    return dist\n`,
    cpp: `vector<long long> dijkstra(vector<vector<pair<int,int>>>& adj,int s,int n){vector<long long> d(n,LLONG_MAX);d[s]=0;priority_queue<pair<long long,int>,vector<pair<long long,int>>,greater<>> pq;pq.push({0,s});while(!pq.empty()){auto[cd,u]=pq.top();pq.pop();if(cd>d[u])continue;for(auto[v,w]:adj[u])if(cd+w<d[v]){d[v]=cd+w;pq.push({d[v],v});}}return d;}\n`,
  },
  fenwick: {
    desc: "Fenwick tree (BIT)",
    python: `class Fenwick:\n    def __init__(self,n): self.n=n; self.t=[0]*(n+1)\n    def add(self,i,v):\n        i+=1\n        while i<=self.n: self.t[i]+=v; i+=i&-i\n    def sum(self,i):\n        i+=1; s=0\n        while i>0: s+=self.t[i]; i-=i&-i\n        return s\n`,
    cpp: `struct Fenwick{int n;vector<long long> t;Fenwick(int n):n(n),t(n+1,0){}void add(int i,long long v){for(++i;i<=n;i+=i&-i)t[i]+=v;}long long sum(int i){long long s=0;for(++i;i>0;i-=i&-i)s+=t[i];return s;}};\n`,
  },
};

export const LESSON_SKELETON = `# عنوان درسنامه

مقدمهٔ کوتاه دربارهٔ موضوع این درسنامه. **مفهوم اصلی** را در یکی دو جمله معرفی کنید.

## **مفهوم اول** در *Python*

توضیح مفهوم پیش از کد.

\`\`\`python solution.py
print("hello")
\`\`\`

- این بلوک کد چه می‌کند و خروجی‌اش چیست را در چهار تا پنج جمله توضیح دهید.

<details>
<summary>**نکته: یک نکتهٔ تکمیلی**</summary>

محتوای واقعی و آموزندهٔ اضافی اینجا قرار می‌گیرد.

</details>
`;

export const PROBLEM_SKELETON = `# عنوان مسئله

**علی** مهندس نرم‌افزار در یک استارتاپ ایرانی است و باید ... . داستان به صورت نثر روان.

# پروژهٔ اولیه

برای دانلود پروژهٔ اولیه روی %problem.initial_project% کلیک کنید.

# جزئیات

شرح دقیق ورودی، خروجی و محدودیت‌ها.

# نمونه

%problem.test_1%

# آنچه باید آپلود کنید

+ **توجه:** فایل‌های خواسته‌شده را طبق ساختار بالا آپلود کنید.
`;
