/* Kélita Produção — uso no celular.
   Abaixo de 1024 px o menu lateral vira uma gaveta aberta pelo botão ☰ do cabeçalho.
   O restante da adaptação (grades, tabelas com rolagem, janelas, abas) está em app.css. */
(function () {
    const LIMITE = 1024;
    const celular = () => window.innerWidth < LIMITE;

    function definir(aberto) {
        document.body.classList.toggle('menu-aberto', aberto);
        const btn = document.getElementById('btnMenu');
        if (btn) {
            btn.setAttribute('aria-expanded', aberto ? 'true' : 'false');
            btn.setAttribute('aria-label', aberto ? 'Fechar menu' : 'Abrir menu');
            const i = btn.querySelector('i');
            if (i) i.className = 'fa-solid ' + (aberto ? 'fa-xmark' : 'fa-bars');
        }
    }

    window.menuAlternar = function () { definir(!document.body.classList.contains('menu-aberto')); };
    window.menuFechar = function () { definir(false); };

    document.addEventListener('DOMContentLoaded', () => {
        const menu = document.getElementById('menuLateral');
        // Escolher uma tela no menu fecha a gaveta no celular
        if (menu) menu.addEventListener('click', e => {
            if (celular() && e.target.closest('a, button')) setTimeout(menuFechar, 0);
        });
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && document.body.classList.contains('menu-aberto')) menuFechar();
    });
    window.addEventListener('resize', () => { if (!celular()) menuFechar(); });

    // Trocar de tela por outros caminhos (sino de alertas, atalhos) também fecha a gaveta
    const trocar = window.showTab;
    if (typeof trocar === 'function') {
        window.showTab = function () {
            const r = trocar.apply(this, arguments);
            if (celular()) menuFechar();
            return r;
        };
    }
})();
