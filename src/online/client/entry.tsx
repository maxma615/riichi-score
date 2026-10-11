import {createRoot} from 'react-dom/client';
import {MahjongClient} from './mahjong-client';
import './table.css';
import './theme.css';
createRoot(document.getElementById('online-root')!).render(<MahjongClient/>);
