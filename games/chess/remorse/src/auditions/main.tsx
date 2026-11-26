import '@fontsource-variable/manrope';
import '@fontsource-variable/cormorant-garamond';
import '../ui/styles.css';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { Auditions } from './Auditions';

createRoot(document.getElementById('root')!).render(<Auditions />);
