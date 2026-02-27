import { createRoot } from 'react-dom/client';
import AuthWindow from './AuthWindow.jsx';

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<AuthWindow />);
