// Username is the display name; the server's stable ID owns all records.
export function mountAccountName(host, { name, api, changed }) {
  const card = document.createElement('div');
  card.className = 'card';
  const title = document.createElement('h2');
  title.textContent = name ? '我的名字' : '用户名登录';
  const form = document.createElement('form');
  form.id = 'account-name-form';
  const label = document.createElement('label');
  label.textContent = '用户名 / 昵称';
  const input = document.createElement('input');
  input.name = 'username'; input.required = true; input.maxLength = 24;
  input.value = name || ''; input.placeholder = '输入中文或英文名字';
  input.autocomplete = 'username';
  label.append(input);
  const hint = document.createElement('p'); hint.className = 'muted';
  hint.textContent = name ? '改名后，其他浏览器用新名字登录。历史记录会同步显示新名字。' : '已有名字直接登录；新名字自动创建账号。';
  const button = document.createElement('button'); button.className = 'primary';
  button.type = 'submit'; button.textContent = name ? '保存名字' : '登录 / 创建账号';
  const error = document.createElement('p'); error.setAttribute('role','status');
  form.append(label,hint,button,error); card.append(title,form); host.prepend(card);
  form.onsubmit = async event => {
    event.preventDefault(); if(button.disabled) return;
    button.disabled=true; error.textContent='';
    try {
      const result = await api(name ? '/api/profile' : '/api/session',{name:input.value});
      await changed(name ? result : result.user);
    } catch(e) {error.textContent=e.message;} finally {button.disabled=false;}
  };
}
